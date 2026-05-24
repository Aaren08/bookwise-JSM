import { test, expect } from "../../fixtures/resilience-fixture";
import { Page } from "@playwright/test";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  waitForDashboardConnected,
  waitForDashboardRefresh,
  getSseConnections,
  ADMIN_DASHBOARD_SSE_URL,
  ADMIN_SESSION_SSE_URL,
  createSseInterceptorScript,
} from "../../utils/sse";
import {
  assertNoDuplicateSseSubscriptions,
  waitForSseReconnected,
  terminateSseAndWaitForReconnect,
  getSseReconnectStats,
} from "../../utils/resilience/sse-reconnect-helpers";
import { SigninPage } from "../../pages/auth/signin.page";
import { AdminDashboardPage } from "../../pages/admin/dashboard.page";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `sse-rec-${WORKER_ID}`;
const SSE_TIMEOUT = 30_000;

const TEST_ADMIN = {
  email: `${TEST_PREFIX}-admin@bookwise-test.com`,
  password: "SseRecAdmin1!",
  fullName: "SSE Recovery Admin",
};

async function ensureAdminExists() {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEST_ADMIN.email))
    .limit(1);
  if (existing.length === 0) {
    const hashed = await bcrypt.hash(TEST_ADMIN.password, 10);
    await db.insert(users).values({
      fullName: TEST_ADMIN.fullName,
      email: TEST_ADMIN.email,
      password: hashed,
      status: "APPROVED",
      role: "ADMIN",
      sessionVersion: 1,
    });
  } else {
    await db
      .update(users)
      .set({ status: "APPROVED", role: "ADMIN", sessionVersion: 1 })
      .where(eq(users.email, TEST_ADMIN.email));
  }
}

async function triggerDashboardBroadcast(page: Page) {
  const response = await page.request.post(ADMIN_DASHBOARD_SSE_URL);
  expect(response.ok()).toBe(true);
}

async function signInAdmin(page: Page) {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(TEST_ADMIN.email, TEST_ADMIN.password);
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test.describe("SSE Failure + Recovery", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    await ensureAdminExists();
  });

  test.afterAll(async () => {
    await db
      .delete(users)
      .where(ilike(users.email, `${TEST_PREFIX}%`))
      .catch(() => {});
  });

  test("SSE stream disconnects and reconnects gracefully", async ({
    adminPage,
    consoleMonitor,
  }) => {
    const dashboardPage = new AdminDashboardPage(adminPage);

    await test.step("1. Admin signs in and dashboard loads with SSE", async () => {
      await signInAdmin(adminPage);
      await dashboardPage.goto();
      await dashboardPage.waitForStatsToRender(15_000);
      await waitForDashboardConnected(adminPage, 15_000);
    });

    const statsBefore =
      await test.step("2. Capture initial stats", async () => {
        return {
          totalUsers: await dashboardPage.getStatValue("Total Users"),
          borrowedBooks: await dashboardPage.getStatValue("Borrowed Books"),
        };
      });

    await test.step("3. Terminate SSE connection by blocking endpoint temporarily", async () => {
      await terminateSseAndWaitForReconnect(
        adminPage,
        "**/api/admin/dashboard/realtime",
        3_000,
      );
    });

    await test.step("4. SSE reconnects automatically", async () => {
      await waitForDashboardConnected(adminPage, SSE_TIMEOUT);
    });

    await test.step("5. Dashboard still functional after reconnect", async () => {
      await triggerDashboardBroadcast(adminPage);
      await waitForDashboardRefresh(adminPage, SSE_TIMEOUT);
    });

    await test.step("6. Stats remain consistent", async () => {
      const current = await dashboardPage.getStatValue("Total Users");
      expect(current).toBe(statsBefore.totalUsers);
    });

    await test.step("7. No duplicate SSE subscriptions accumulated", async () => {
      await assertNoDuplicateSseSubscriptions(
        adminPage,
        ADMIN_DASHBOARD_SSE_URL,
        4,
      );
    });

    await test.step("8. Admin stays on dashboard", async () => {
      expect(adminPage.url()).toContain("/admin");
    });

    await test.step("9. No critical errors", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "EventSource",
        "ERR_ABORTED",
        "ERR_INTERNET_DISCONNECTED",
        "_next/",
        "_rsc=",
        "/admin",
        "Failed to refresh admin dashboard",
        "SSE error",
        "RealtimeClient",
      ]);
    });
  });

  test("SSE reconnect stress: repeated disconnect/reconnect cycles", async ({
    adminPage,
    consoleMonitor,
  }) => {
    const dashboardPage = new AdminDashboardPage(adminPage);

    await test.step("1. Setup dashboard with SSE", async () => {
      await signInAdmin(adminPage);
      await dashboardPage.goto();
      await dashboardPage.waitForStatsToRender(15_000);
      await waitForDashboardConnected(adminPage, 15_000);
    });

    const cycles = 3;
    for (let i = 0; i < cycles; i++) {
      await test.step(`2.${i} Cycle ${i + 1}: disconnect and reconnect SSE`, async () => {
        await terminateSseAndWaitForReconnect(
          adminPage,
          "**/api/admin/dashboard/realtime",
          2_000,
        );
        await waitForSseReconnected(
          adminPage,
          ADMIN_DASHBOARD_SSE_URL,
          SSE_TIMEOUT,
        );
      });
    }

    await test.step("3. Dashboard still functional after reconnect cycles", async () => {
      await dashboardPage.waitForStatsToRender(15_000);
    });

    await test.step("4. No duplicate SSE connections across cycles", async () => {
      const stats = await getSseReconnectStats(adminPage);
      expect(stats.totalConnections).toBeLessThanOrEqual(15);
    });

    await test.step("5. No critical errors across all cycles", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "EventSource",
        "ERR_ABORTED",
        "ERR_INTERNET_DISCONNECTED",
        "_next/",
        "_rsc=",
        "/admin",
        "Failed to refresh admin dashboard",
        "SSE error",
        "RealtimeClient",
        "reconnect",
      ]);
    });
  });

  test("session SSE recovers after disconnect", async ({
    adminPage,
    consoleMonitor,
  }) => {
    await test.step("1. Admin signs in and loads dashboard", async () => {
      await signInAdmin(adminPage);
      await adminPage.goto("/admin");
      await expect(
        adminPage.locator(".stat-card_container").first(),
      ).toBeVisible({
        timeout: 15_000,
      });

      await expect
        .poll(
          async () => {
            const connections = await getSseConnections(adminPage);
            return connections.some(
              (c) =>
                c.url.includes(ADMIN_SESSION_SSE_URL) && c.readyState === 1,
            );
          },
          { timeout: 15_000, message: "Session SSE should connect" },
        )
        .toBe(true);
    });

    await test.step("2. Interrupt session SSE", async () => {
      await terminateSseAndWaitForReconnect(
        adminPage,
        "**/api/admin/session/realtime",
        3_000,
      );
    });

    await test.step("3. Session SSE reconnects", async () => {
      await expect
        .poll(
          async () => {
            const connections = await getSseConnections(adminPage);
            return connections.some(
              (c) =>
                c.url.includes(ADMIN_SESSION_SSE_URL) && c.readyState === 1,
            );
          },
          {
            timeout: SSE_TIMEOUT,
            message: "Session SSE should reconnect",
          },
        )
        .toBe(true);
    });

    await test.step("4. No duplicate session SSE subscriptions", async () => {
      await assertNoDuplicateSseSubscriptions(
        adminPage,
        ADMIN_SESSION_SSE_URL,
        4,
      );
    });

    await test.step("5. No critical errors", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "EventSource",
        "ERR_ABORTED",
        "_next/",
        "_rsc=",
        "/admin",
        "SSE error",
        "RealtimeClient",
      ]);
    });
  });

  test("multiple tabs: SSE reconnects independently per tab", async ({
    adminContext,
  }) => {
    const tab1 = await adminContext.newPage();
    const tab2 = await adminContext.newPage();
    await tab1.addInitScript({ content: createSseInterceptorScript() });
    await tab2.addInitScript({ content: createSseInterceptorScript() });

    await test.step("1. Sign in and load dashboard in both tabs", async () => {
      for (const page of [tab1, tab2]) {
        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.signIn(TEST_ADMIN.email, TEST_ADMIN.password);
        await expect(page).not.toHaveURL(/\/sign-in/);
        const dp = new AdminDashboardPage(page);
        await dp.goto();
        await dp.waitForStatsToRender(15_000);
        await waitForDashboardConnected(page, 15_000);
      }
    });

    await test.step("2. Interrupt SSE on tab1 only", async () => {
      await terminateSseAndWaitForReconnect(
        tab1,
        "**/api/admin/dashboard/realtime",
        3_000,
      );
    });

    await test.step("3. Tab1 SSE reconnects", async () => {
      await waitForSseReconnected(tab1, ADMIN_DASHBOARD_SSE_URL, SSE_TIMEOUT);
    });

    await test.step("4. Tab2 SSE remains active throughout", async () => {
      const tab2Connections = await getSseConnections(tab2);
      const tab2Active = tab2Connections.some(
        (c) => c.url.includes(ADMIN_DASHBOARD_SSE_URL) && c.readyState === 1,
      );
      expect(tab2Active).toBe(true);
    });

    await test.step("5. Both tabs remain on dashboard", async () => {
      expect(tab1.url()).toContain("/admin");
      expect(tab2.url()).toContain("/admin");
    });

    await tab1.close();
    await tab2.close();
  });

  test("SSE duplicate subscriptions do not accumulate after multiple reconnects", async ({
    adminPage,
    consoleMonitor,
  }) => {
    const dashboardPage = new AdminDashboardPage(adminPage);

    await test.step("1. Setup dashboard", async () => {
      await signInAdmin(adminPage);
      await dashboardPage.goto();
      await dashboardPage.waitForStatsToRender(15_000);
      await waitForDashboardConnected(adminPage, 15_000);
    });

    await test.step("2. Perform 5 rapid disconnect/reconnect cycles", async () => {
      for (let i = 0; i < 5; i++) {
        await adminPage.route("**/api/admin/dashboard/realtime", (route) => {
          route.abort("connectionrefused");
        });
        await adminPage.waitForTimeout(500);
        await adminPage.unroute("**/api/admin/dashboard/realtime");
        await adminPage.waitForTimeout(2_000);
      }
    });

    await test.step("3. Wait for stable connection", async () => {
      await waitForSseReconnected(
        adminPage,
        ADMIN_DASHBOARD_SSE_URL,
        SSE_TIMEOUT,
      );
    });

    await test.step("4. Verify connection count is bounded", async () => {
      const connections = await getSseConnections(adminPage);
      const dashboardConns = connections.filter((c) =>
        c.url.includes(ADMIN_DASHBOARD_SSE_URL),
      );
      expect(dashboardConns.length).toBeLessThanOrEqual(10);
    });

    await test.step("5. Dashboard still renders correctly", async () => {
      await dashboardPage.waitForStatsToRender(15_000);
    });

    await test.step("6. No critical errors", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "EventSource",
        "ERR_ABORTED",
        "ERR_INTERNET_DISCONNECTED",
        "_next/",
        "_rsc=",
        "/admin",
        "Failed to refresh admin dashboard",
        "SSE error",
        "RealtimeClient",
      ]);
    });
  });
});
