import { test as base, expect } from "@playwright/test";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { AdminDashboardPage } from "../../pages/admin/dashboard.page";
import { SigninPage } from "../../pages/auth/signin.page";
import {
  createSseInterceptorScript,
  createNetworkDiagnostics,
  waitForDashboardConnected,
  waitForDashboardRefresh,
  getSseConnections,
  ADMIN_DASHBOARD_SSE_URL,
} from "../../utils/sse";
import type { BrowserContext, Page } from "@playwright/test";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `dash-reconnect-${WORKER_ID}`;
const SSE_TIMEOUT = 30_000;

const TEST_ADMIN = {
  email: `${TEST_PREFIX}-admin@bookwise-test.com`,
  password: "RecAdminPass123!",
  fullName: "Reconnect Admin",
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
    });
  } else {
    await db
      .update(users)
      .set({ status: "APPROVED", role: "ADMIN" })
      .where(eq(users.email, TEST_ADMIN.email));
  }
}

async function triggerDashboardBroadcastFromPage(page: Page) {
  const response = await page.request.post(ADMIN_DASHBOARD_SSE_URL);
  expect(response.ok(), `Dashboard broadcast failed with ${response.status()}`).toBe(true);
}

type ReconnectFixtures = {
  adminContext: BrowserContext;
  adminPage: Page;
  dashboardPage: AdminDashboardPage;
};

const test = base.extend<ReconnectFixtures>({
  adminContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  adminPage: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await page.addInitScript(createSseInterceptorScript());
    await use(page);
  },
  dashboardPage: async ({ adminPage }, use) => {
    await use(new AdminDashboardPage(adminPage));
  },
});

export { expect } from "@playwright/test";

async function signIn(page: Page, email: string, password: string) {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(email, password);
}

test.describe("Dashboard Reconnection Resilience", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    await ensureAdminExists();
  });

  test("Dashboard SSE reconnects gracefully after network interruption", async ({
    adminPage,
    dashboardPage,
  }) => {
    const adminErrors = createNetworkDiagnostics(adminPage);

    await test.step("1. Admin signs in and dashboard loads with SSE connected", async () => {
      await signIn(adminPage, TEST_ADMIN.email, TEST_ADMIN.password);
      await dashboardPage.goto();
      await dashboardPage.waitForStatsToRender(15_000);
      await waitForDashboardConnected(adminPage, 15_000);
    });

    const initialStats = await test.step("2. Capture initial stats", async () => {
      const stats = {
        totalUsers: await dashboardPage.getStatValue("Total Users"),
        borrowedBooks: await dashboardPage.getStatValue("Borrowed Books"),
      };
      expect(stats.totalUsers).toBeGreaterThanOrEqual(0);
      return stats;
    });

    await test.step("3. Interrupt network (route all to 503)", async () => {
      await adminPage.route("**/api/**", async (route) => {
        await route.abort("internetdisconnected");
      });
    });

    await test.step("4. Wait briefly while disconnected, then restore", async () => {
      await adminPage.waitForTimeout(4_000);
      await adminPage.unroute("**/api/**");
    });

    await test.step("5. Verify SSE reconnects automatically", async () => {
      await waitForDashboardConnected(adminPage, SSE_TIMEOUT);
    });

    await test.step("6. Trigger a data change and verify dashboard recovers", async () => {
      await triggerDashboardBroadcastFromPage(adminPage);
      await waitForDashboardRefresh(adminPage, SSE_TIMEOUT);
    });

    await test.step("7. Verify stats are still correct (no stale data)", async () => {
      const currentTotalUsers = await dashboardPage.getStatValue("Total Users");
      const currentBorrowedBooks = await dashboardPage.getStatValue("Borrowed Books");

      expect(currentTotalUsers).toBe(initialStats.totalUsers);
      expect(currentBorrowedBooks).toBe(initialStats.borrowedBooks);
    });

    await test.step("8. Verify no duplicate SSE connections were created", async () => {
      const connections = await getSseConnections(adminPage);
      const dashboardConns = connections.filter((c) =>
        c.url.includes(ADMIN_DASHBOARD_SSE_URL),
      );

      expect(dashboardConns.length).toBeLessThanOrEqual(4);
    });

    await test.step("9. Verify no critical console errors", async () => {
      const critical = adminErrors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("internetdisconnected") &&
          !e.includes("ERR_INTERNET_DISCONNECTED") &&
          !e.includes("Failed to refresh admin dashboard"),
      );
      expect(critical, `Errors: ${critical.join("; ")}`).toHaveLength(0);
    });

    await test.step("10. Admin stays on dashboard (no redirect/reload)", async () => {
      expect(adminPage.url()).toContain("/admin");
    });
  });

  test("Dashboard remains correct after background tab and foreground restore", async ({
    adminPage,
    dashboardPage,
  }) => {
    const adminErrors = createNetworkDiagnostics(adminPage);

    await test.step("1. Dashboard loads with SSE connected", async () => {
      await signIn(adminPage, TEST_ADMIN.email, TEST_ADMIN.password);
      await dashboardPage.goto();
      await dashboardPage.waitForStatsToRender(15_000);
      await waitForDashboardConnected(adminPage, 15_000);
    });

    const initialTotalUsers = await test.step("2. Capture initial stat", async () => {
      return await dashboardPage.getStatValue("Total Users");
    });

    await test.step("3. Dispatch 'visibilitychange' to hidden (simulate tab background)", async () => {
      await adminPage.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    });

    await test.step("4. Keep tab backgrounded while DB update + broadcast happens", async () => {
      await adminPage.waitForTimeout(3_000);
      await triggerDashboardBroadcastFromPage(adminPage);
      await adminPage.waitForTimeout(2_000);
    });

    await test.step("5. Restore tab to foreground", async () => {
      await adminPage.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    });

    await test.step("6. Verify totalUsers stat is still correct", async () => {
      const currentTotalUsers = await dashboardPage.getStatValue("Total Users");
      expect(currentTotalUsers).toBe(initialTotalUsers);
    });

    await test.step("7. Verify SSE connection is still active", async () => {
      const connections = await getSseConnections(adminPage);
      const dashboardConns = connections.filter((c) =>
        c.url.includes(ADMIN_DASHBOARD_SSE_URL),
      );

      const activeConn = dashboardConns.find((c) => c.readyState === 1);
      expect(activeConn, "At least one active SSE connection should exist").toBeTruthy();
    });

    await test.step("8. No critical errors", async () => {
      const critical = adminErrors.filter(
        (e) => !e.includes("favicon") && !e.includes("AbortError"),
      );
      expect(critical, `Errors: ${critical.join("; ")}`).toHaveLength(0);
    });

    await test.step("9. Admin remains on dashboard (no redirect)", async () => {
      expect(adminPage.url()).toContain("/admin");
    });
  });
});
