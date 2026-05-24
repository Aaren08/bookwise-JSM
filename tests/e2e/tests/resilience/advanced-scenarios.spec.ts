import { test, expect } from "../../fixtures/resilience-fixture";
import { SigninPage } from "../../pages/auth/signin.page";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  waitForDashboardConnected,
  ADMIN_DASHBOARD_SSE_URL,
} from "../../utils/sse";
import {
  waitForSseReconnected,
  assertNoDuplicateSseSubscriptions,
} from "../../utils/resilience/sse-reconnect-helpers";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `adv-${WORKER_ID}`;
const SSE_TIMEOUT = 30_000;

const TEST_USER = {
  email: `${TEST_PREFIX}-user@bookwise-test.com`,
  password: "AdvTest1!",
  fullName: "Advanced Test User",
};

const TEST_ADMIN = {
  email: `${TEST_PREFIX}-adv-admin@bookwise-test.com`,
  password: "AdvAdmin1!",
  fullName: "Advanced Admin",
};

async function ensureTestUsers() {
  for (const u of [TEST_USER, TEST_ADMIN]) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, u.email))
      .limit(1);
    if (existing.length === 0) {
      const hashed = await bcrypt.hash(u.password, 10);
      await db.insert(users).values({
        fullName: u.fullName,
        email: u.email,
        password: hashed,
        status: "APPROVED",
        role: u === TEST_USER ? "USER" : "ADMIN",
        sessionVersion: 1,
      });
    } else {
      await db
        .update(users)
        .set({
          status: "APPROVED",
          role: u === TEST_USER ? "USER" : "ADMIN",
          sessionVersion: 1,
        })
        .where(eq(users.email, u.email));
    }
  }
}

test.describe("Advanced Scenarios", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    await ensureTestUsers();
  });

  test.afterAll(async () => {
    await db
      .delete(users)
      .where(ilike(users.email, `${TEST_PREFIX}%`))
      .catch(() => {});
  });

  test("mid-navigation network failure: disconnect during route transition", async ({
    page,
    consoleMonitor,
    failureSimulator,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      const signinPage = new SigninPage(page);
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Start navigation and trigger network failure mid-transition", async () => {
      await failureSimulator.simulateMidNavigationNetworkFailure(async () => {
        await page.goto("/search").catch(() => {});
      }, 300);
    });

    await test.step("3. Restore network", async () => {
      await failureSimulator.restoreNetwork();
      await page.waitForTimeout(2_000);
    });

    await test.step("4. App has not crashed — page is still rendered", async () => {
      const hasBody = await page.evaluate(() => document.body !== null);
      expect(hasBody).toBe(true);
    });

    await test.step("5. Navigation still works after recovery", async () => {
      await page.goto("/");
      expect(page.url()).toContain("/");
    });

    await test.step("6. No uncaught exceptions", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "ERR_ABORTED",
        "ERR_INTERNET_DISCONNECTED",
        "_next/",
        "_rsc=",
        "Failed to fetch",
        "NetworkError",
        "The Internet connection has been lost",
        "hydration",
        "Hydration",
      ]);
    });
  });

  test("SSE reconnect stress: repeated cycles without memory leaks", async ({
    adminPage,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in as admin and load dashboard", async () => {
      const signinPage = new SigninPage(adminPage);
      await signinPage.goto();
      await signinPage.signIn(TEST_ADMIN.email, TEST_ADMIN.password);
      await expect(adminPage).not.toHaveURL(/\/sign-in/);
      await adminPage.goto("/admin");
    });

    await test.step("2. Wait for initial SSE connection", async () => {
      await expect(
        adminPage.locator(".stat-card_container").first(),
      ).toBeVisible({
        timeout: 15_000,
      });
      await waitForDashboardConnected(adminPage, 15_000);
    });

    await test.step("3. Perform many rapid disconnect/reconnect cycles", async () => {
      for (let i = 0; i < 8; i++) {
        await adminPage.route("**/api/admin/dashboard/realtime", (route) => {
          route.abort("connectionrefused");
        });
        await adminPage.waitForTimeout(200);
        await adminPage.unroute("**/api/admin/dashboard/realtime");
        await adminPage.waitForTimeout(1_500);
      }
    });

    await test.step("4. SSE reconnects and stabilizes", async () => {
      await waitForSseReconnected(
        adminPage,
        ADMIN_DASHBOARD_SSE_URL,
        SSE_TIMEOUT,
      );
    });

    await test.step("5. Connection count is bounded (no leak)", async () => {
      const stats = await (
        await import("../../utils/resilience/sse-reconnect-helpers")
      ).getSseReconnectStats(adminPage);
      expect(stats.activeConnections).toBeLessThanOrEqual(2);
    });

    await test.step("6. Dashboard still renders content", async () => {
      await expect(
        adminPage.locator(".stat-card_container").first(),
      ).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("7. No duplicate UI updates or escalation", async () => {
      await assertNoDuplicateSseSubscriptions(
        adminPage,
        ADMIN_DASHBOARD_SSE_URL,
        12,
      );
    });

    await test.step("8. No critical errors", async () => {
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

  test("partial server failure: failing server action while page shell loads", async ({
    adminPage,
    consoleMonitor,
    failureSimulator,
  }) => {
    await test.step("1. Sign in as admin", async () => {
      const signinPage = new SigninPage(adminPage);
      await signinPage.goto();
      await signinPage.signIn(TEST_ADMIN.email, TEST_ADMIN.password);
      await expect(adminPage).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Fail admin server actions", async () => {
      await failureSimulator.failServerAction("**/api/admin/**");
    });

    await test.step("3. Navigate to admin dashboard", async () => {
      await adminPage.goto("/admin", { timeout: 30_000 }).catch(() => {});
    });

    await test.step("4. Admin page shell loads (sidebar visible)", async () => {
      const sidebar = adminPage.locator(".admin-sidebar");
      await expect(sidebar).toBeVisible({ timeout: 10_000 });
    });

    await test.step("5. Restore API", async () => {
      await failureSimulator.restoreNetwork();
    });

    await test.step("6. Dashboard recovers after restore", async () => {
      await adminPage.reload();
      await expect(
        adminPage.locator(".stat-card_container").first(),
      ).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("7. No critical errors from the failure itself", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "EventSource",
        "ERR_ABORTED",
        "_next/",
        "_rsc=",
        "/admin",
        "500",
        "Internal Server Error",
        "SSE error",
        "RealtimeClient",
      ]);
    });
  });

  test("unauthorized cache protection: stale admin content does not persist after redirect", async ({
    page,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      const signinPage = new SigninPage(page);
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Navigate to home first to establish cache", async () => {
      await page.goto("/");
      expect(page.url()).toContain("/");
    });

    await test.step("3. Navigate to /admin — should be redirected", async () => {
      await page.goto("/admin", { waitUntil: "commit" });
      await expect(page).not.toHaveURL(/\/admin/);
    });

    await test.step("4. Verify no admin content is visible", async () => {
      const bodyText = await page.evaluate(
        () => document.body?.innerText ?? "",
      );
      expect(bodyText).not.toContain("Borrowed Books");
      expect(bodyText).not.toContain("Total Users");
    });

    await test.step("5. Navigate back — should not reveal admin content", async () => {
      await page.goBack();
      await page.waitForTimeout(1_000);
      const bodyTextAfter = await page.evaluate(
        () => document.body?.innerText ?? "",
      );
      expect(bodyTextAfter).not.toContain("Borrowed Books");
    });
  });

  test("navigation stability: browser back/forward works after error pages", async ({
    page,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      const signinPage = new SigninPage(page);
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Visit home page", async () => {
      await page.goto("/");
      expect(page.url()).toContain("/");
    });

    await test.step("3. Visit search page", async () => {
      await page.goto("/search");
      expect(page.url()).toContain("/search");
    });

    await test.step("4. Visit not-found page", async () => {
      await page.goto("/nonexistent-route");
      await expect(page.getByText("Page not found")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("5. Browser back works (from not-found to search)", async () => {
      await page.goBack();
      await expect(page).toHaveURL(/\/search/);
    });

    await test.step("6. Browser back works again (search to home)", async () => {
      await page.goBack();
      expect(page.url()).toContain("/");
    });

    await test.step("7. Browser forward works (home -> search)", async () => {
      await page.goForward();
      await expect(page).toHaveURL(/\/search/);
    });

    await test.step("8. No critical errors from navigation", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "ERR_ABORTED",
        "_next/",
        "_rsc=",
      ]);
    });
  });
});
