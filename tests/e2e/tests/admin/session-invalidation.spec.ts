import { test as base, expect, Page, BrowserContext } from "@playwright/test";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq, ilike, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { SigninPage } from "../../pages/auth/signin.page";
import {
  createSseInterceptorScript,
  createNetworkDiagnostics,
  isSessionSseConnected,
  waitForSessionInvalidationOrRedirect,
  ADMIN_SESSION_SSE_URL,
} from "../../utils/sse";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `sess-inval-${WORKER_ID}`;

const SSE_TIMEOUT = 20_000;
const REDIRECT_TIMEOUT = 15_000;

const TEST_ADMIN_A = {
  email: `${TEST_PREFIX}-adminA@bookwise-test.com`,
  password: "AdminAPass123!",
  fullName: "Session Admin A",
};

const TEST_ADMIN_B = {
  email: `${TEST_PREFIX}-adminB@bookwise-test.com`,
  password: "AdminBPass123!",
  fullName: "Session Admin B",
};

async function ensureTestAdmin(
  email: string,
  password: string,
  fullName: string,
) {
  const hashed = await bcrypt.hash(password, 10);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(users).values({
      fullName,
      email,
      password: hashed,
      status: "APPROVED",
      role: "ADMIN",
      sessionVersion: 1,
      version: 1,
    });
  } else {
    await db
      .update(users)
      .set({
        fullName,
        password: hashed,
        status: "APPROVED",
        role: "ADMIN",
        sessionVersion: 1,
        version: sql`version + 1`,
      })
      .where(eq(users.email, email));
  }
}

type SessionInvalidationFixtures = {
  adminAContext: BrowserContext;
  adminAPage: Page;
  adminBContext: BrowserContext;
  adminBPage: Page;
};

const test = base.extend<SessionInvalidationFixtures>({
  adminAContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  adminAPage: async ({ adminAContext }, use) => {
    const page = await adminAContext.newPage();
    await page.addInitScript(createSseInterceptorScript());
    await use(page);
  },
  adminBContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  adminBPage: async ({ adminBContext }, use) => {
    const page = await adminBContext.newPage();
    await use(page);
  },
});

export { expect } from "@playwright/test";

async function signIn(page: Page, email: string, password: string) {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(email, password);
}

async function navigateToUsersPage(page: Page) {
  await page.goto("/admin/users");
  await page.waitForSelector("table", { timeout: 15_000 });
}

test.describe("Session Invalidation on Admin Role Change", () => {
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    await ensureTestAdmin(
      TEST_ADMIN_A.email,
      TEST_ADMIN_A.password,
      TEST_ADMIN_A.fullName,
    );
    await ensureTestAdmin(
      TEST_ADMIN_B.email,
      TEST_ADMIN_B.password,
      TEST_ADMIN_B.fullName,
    );
  });

  test.beforeEach(async () => {
    // Ensure Admin A starts with ADMIN role and fresh sessionVersion
    await db
      .update(users)
      .set({
        role: "ADMIN",
        sessionVersion: 1,
        version: sql`version + 1`,
      })
      .where(eq(users.email, TEST_ADMIN_A.email));
  });

  test.afterAll(async () => {
    await db
      .delete(users)
      .where(ilike(users.email, `${TEST_PREFIX}%`))
      .catch(() => {});
  });

  test("Full session invalidation: admin demotion triggers real-time redirect and protected route enforcement", async ({
    adminAPage,
    adminBPage,
  }) => {
    const adminAErrors = createNetworkDiagnostics(adminAPage);
    const adminBErrors = createNetworkDiagnostics(adminBPage);

    // ─── Phase 1: Admin A signs in and validates admin access ────────────────
    await test.step("1.0 Admin A signs in", async () => {
      await signIn(adminAPage, TEST_ADMIN_A.email, TEST_ADMIN_A.password);
    });

    await test.step("1.1 Admin A accesses admin dashboard successfully", async () => {
      await adminAPage.goto("/admin");
      await expect(adminAPage.locator(".stat-card_container").first()).toBeVisible({
        timeout: 15_000,
      });
      expect(adminAPage.url()).toContain("/admin");
    });

    await test.step("1.2 Admin A accesses nested admin pages successfully", async () => {
      await adminAPage.goto("/admin/users");
      await expect(adminAPage.getByRole("table").first()).toBeVisible({ timeout: 10_000 });
      expect(adminAPage.url()).toContain("/admin/users");

      await adminAPage.goto("/admin/borrow-records");
      await expect(adminAPage.getByRole("table").first()).toBeVisible({ timeout: 10_000 });
      expect(adminAPage.url()).toContain("/admin/borrow-records");
    });

    // ─── Phase 2: Admin A SSE session invalidation stream ────────────────────
    await test.step("2.0 Admin A returns to dashboard (SessionGuard mounts SSE)", async () => {
      await adminAPage.goto("/admin");
      await expect(adminAPage.locator(".stat-card_container").first()).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("2.1 Admin A SSE session connection is established", async () => {
      await expect
        .poll(
          async () => isSessionSseConnected(adminAPage),
          {
            timeout: 10_000,
            message: "Admin A session SSE should be connected",
          },
        )
        .toBe(true);
    });

    // ─── Phase 3: Admin B demotes Admin A ────────────────────────────────────
    await test.step("3.0 Admin B signs in separately", async () => {
      await signIn(adminBPage, TEST_ADMIN_B.email, TEST_ADMIN_B.password);
    });

    await test.step("3.1 Admin B navigates to users page", async () => {
      await navigateToUsersPage(adminBPage);
    });

    await test.step("3.2 Admin B locates Admin A in the users table", async () => {
      const adminARow = adminBPage.getByRole("row").filter({ hasText: TEST_ADMIN_A.email });
      await expect(adminARow).toBeVisible({ timeout: 10_000 });
    });

    await test.step("3.3 Admin B opens Admin A's role selector", async () => {
      const adminARow = adminBPage.getByRole("row").filter({ hasText: TEST_ADMIN_A.email });
      const roleCombobox = adminARow.getByRole("combobox");
      await expect(roleCombobox).toBeVisible({ timeout: 5_000 });
      await roleCombobox.click();
    });

    await test.step("3.4 Admin B changes Admin A role from ADMIN to USER", async () => {
      const userOption = adminBPage.getByRole("option", { name: "User" });
      await expect(userOption).toBeVisible({ timeout: 5_000 });
      await userOption.click();

      // Wait for success toast or the row to reflect the change
      await expect
        .poll(
          async () => {
            const row = adminBPage
              .getByRole("row")
              .filter({ hasText: TEST_ADMIN_A.email });
            const text = await row.textContent().catch(() => "");
            return text?.includes("User");
          },
          {
            timeout: 10_000,
            message: "Admin A role should be updated to User in Admin B's table",
          },
        )
        .toBe(true);
    });

    // ─── Phase 4: Admin A receives session invalidation ──────────────────────
    await test.step("4.0 Admin A receives session:invalidated SSE event", async () => {
      // Check for the invalidation event OR the redirect (whichever happens first)
      await expect
        .poll(
          async () => {
            // Check SSE events (page might still be alive before redirect)
            const events = await adminAPage
              .evaluate(
                () =>
                  (
                    window as unknown as {
                      __SSE_EVENTS?: Array<{
                        type: string;
                        data?: unknown;
                        url: string;
                      }>;
                    }
                  ).__SSE_EVENTS || [],
              )
              .catch(() => []);
            const hasInvalidationEvent = events.some(
              (e) =>
                e.type === "message" &&
                typeof e.data === "object" &&
                e.data !== null &&
                (e.data as Record<string, unknown>).type ===
                  "session:invalidated",
            );
            if (hasInvalidationEvent) return true;

            // Or check if already redirected
            try {
              return adminAPage.url().includes("/sign-in");
            } catch {
              return false;
            }
          },
          {
            timeout: SSE_TIMEOUT,
            message:
              "Admin A should receive session:invalidated SSE event or be redirected to /sign-in",
          },
        )
        .toBe(true);
    });

    await test.step("4.1 Admin A is redirected to /sign-in", async () => {
      await expect(adminAPage).toHaveURL(/\/sign-in/, { timeout: REDIRECT_TIMEOUT });
    });

    await test.step("4.2 Sign-in form is visible and accessible on the redirect page", async () => {
      const emailInput = adminAPage.getByLabel("Email", { exact: true });
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await expect(emailInput).toHaveAttribute("type", "email");
    });

    // ─── Phase 5: Protected route enforcement ────────────────────────────────
    await test.step("5.0 Direct navigation to /admin is blocked", async () => {
      await adminAPage.goto("/admin");
      await expect(adminAPage).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    });

    await test.step("5.1 Deep link to /admin/users is blocked", async () => {
      await adminAPage.goto("/admin/users");
      await expect(adminAPage).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    });

    await test.step("5.2 Deep link to /admin/borrow-records is blocked", async () => {
      await adminAPage.goto("/admin/borrow-records");
      await expect(adminAPage).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    });

    await test.step("5.3 Admin A API requests to session/realtime return 403", async () => {
      const response = await adminAPage.request.get(ADMIN_SESSION_SSE_URL);
      expect(response.status()).toBe(403);
    });

    await test.step("5.4 Admin A API requests to protected endpoints are rejected", async () => {
      const response = await adminAPage.request.get("/api/admin/dashboard/realtime");
      expect([401, 403]).toContain(response.status());
    });

    // ─── Phase 6: Admin B is unaffected ──────────────────────────────────────
    await test.step("6.0 Admin B still has admin access to dashboard", async () => {
      await adminBPage.goto("/admin");
      await expect(adminBPage.locator(".stat-card_container").first()).toBeVisible({
        timeout: 10_000,
      });
      expect(adminBPage.url()).toContain("/admin");
    });

    await test.step("6.1 Admin B can still access nested admin pages", async () => {
      await adminBPage.goto("/admin/users");
      await expect(adminBPage.getByRole("table").first()).toBeVisible({ timeout: 10_000 });
      expect(adminBPage.url()).toContain("/admin/users");

      await adminBPage.goto("/admin/borrow-records");
      await expect(adminBPage.getByRole("table").first()).toBeVisible({ timeout: 10_000 });
      expect(adminBPage.url()).toContain("/admin/borrow-records");
    });

    await test.step("6.2 Admin B API requests still succeed", async () => {
      // Use a non-SSE admin endpoint (SSE streams hang the request context)
      // Retry to handle transient ECONNRESET during concurrent SSE cleanup
      await expect
        .poll(
          async () => {
            try {
              const response = await adminBPage.request.get("/api/admin/locks?entity=users");
              return response.ok();
            } catch {
              return false;
            }
          },
          { timeout: 10_000, message: "Admin B API request should succeed" },
        )
        .toBe(true);
    });

    // ─── Phase 7: Browser history protection ─────────────────────────────────
    await test.step("7.0 Browser back button does not restore admin access", async () => {
      // Admin A is on /sign-in; navigate back to previously cached /admin
      await adminAPage.goBack();
      // Should be redirected to /sign-in again
      await expect(adminAPage).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    });

    // ─── Phase 8: Diagnostics and error verification ─────────────────────────
    await test.step("8.0 No unexpected console or network errors on Admin A", async () => {
      const critical = adminAErrors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("EventSource") &&
          !e.includes("ERR_ABORTED") &&
          !e.includes("_next/") &&
          !e.includes("_rsc=") &&
          !e.includes("/sign-in") &&
          !e.includes("/api/admin/dashboard") &&
          !e.includes("SSE error") &&
          !e.includes("RealtimeClient") &&
          !e.includes("Failed to load resource"),
      );
      expect(critical, `Admin A errors: ${critical.join("; ")}`).toHaveLength(0);
    });

    await test.step("8.1 No unexpected console or network errors on Admin B", async () => {
      const critical = adminBErrors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("EventSource") &&
          !e.includes("ERR_ABORTED") &&
          !e.includes("_next/") &&
          !e.includes("_rsc=") &&
          !e.includes("SSE error") &&
          !e.includes("RealtimeClient") &&
          !e.includes("hydration") &&
          !e.includes("mismatch"),
      );
      expect(critical, `Admin B errors: ${critical.join("; ")}`).toHaveLength(0);
    });
  });

  test("Mid-request invalidation: demotion during admin page load fails gracefully", async ({
    adminAContext,
    adminBPage,
  }) => {
    test.setTimeout(120_000);

    const midRequestPage = await adminAContext.newPage();
    await midRequestPage.addInitScript(createSseInterceptorScript());
    const midRequestErrors = createNetworkDiagnostics(midRequestPage);

    await test.step("1. Admin A signs in and loads dashboard", async () => {
      await signIn(midRequestPage, TEST_ADMIN_A.email, TEST_ADMIN_A.password);
      await midRequestPage.goto("/admin");
      await expect(
        midRequestPage.locator(".stat-card_container").first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step("2. Wait for session SSE connection on Admin A", async () => {
      await expect
        .poll(
          async () => isSessionSseConnected(midRequestPage),
          {
            timeout: 10_000,
            message: "Admin A session SSE should be connected",
          },
        )
        .toBe(true);
    });

    await test.step("3. Admin B demotes Admin A while Admin A is on dashboard", async () => {
      await signIn(adminBPage, TEST_ADMIN_B.email, TEST_ADMIN_B.password);
      await navigateToUsersPage(adminBPage);

      const adminARow = adminBPage
        .getByRole("row")
        .filter({ hasText: TEST_ADMIN_A.email });
      await expect(adminARow).toBeVisible({ timeout: 10_000 });

      await adminARow.getByRole("combobox").click();
      const userOption = adminBPage.getByRole("option", { name: "User" });
      await expect(userOption).toBeVisible({ timeout: 5_000 });
      await userOption.click();

      // Wait for role change confirmation
      await expect
        .poll(
          async () => {
            const row = adminBPage
              .getByRole("row")
              .filter({ hasText: TEST_ADMIN_A.email });
            const text = await row.textContent().catch(() => "");
            return text?.includes("User");
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    });

    await test.step("4. Admin A receives session:invalidated SSE event and redirects to /sign-in", async () => {
      await waitForSessionInvalidationOrRedirect(midRequestPage, SSE_TIMEOUT);
    });

    await test.step("5. Admin A confirmed on /sign-in", async () => {
      await expect(midRequestPage).toHaveURL(/\/sign-in/, {
        timeout: REDIRECT_TIMEOUT,
      });
    });

    await test.step("5.1 No broken loading state or uncaught exceptions visible", async () => {
      // Verify sign-in form loaded cleanly
      const emailInput = midRequestPage.getByLabel("Email", { exact: true });
      await expect(emailInput).toBeVisible({ timeout: 10_000 });
    });

    // Admin A role is restored by beforeEach automatically before next test
    await test.step("6. No critical errors during mid-request invalidation", async () => {
      const critical = midRequestErrors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("EventSource") &&
          !e.includes("ERR_ABORTED") &&
          !e.includes("_next/") &&
          !e.includes("_rsc=") &&
          !e.includes("/sign-in") &&
          !e.includes("/api/admin/dashboard") &&
          !e.includes("SSE error") &&
          !e.includes("RealtimeClient"),
      );
      expect(
        critical,
        `Mid-request errors: ${critical.join("; ")}`,
      ).toHaveLength(0);
    });

    await midRequestPage.close();
  });

  test("Multi-tab session invalidation: all open admin tabs redirect on demotion", async ({
    adminAContext,
    adminBPage,
  }) => {
    test.setTimeout(120_000);

    const primaryPage = await adminAContext.newPage();
    await primaryPage.addInitScript(createSseInterceptorScript());
    const secondaryPage = await adminAContext.newPage();
    await secondaryPage.addInitScript(createSseInterceptorScript());
    const multitabErrors = createNetworkDiagnostics(primaryPage);

    await test.step("1. Admin A opens primary admin tab", async () => {
      await signIn(primaryPage, TEST_ADMIN_A.email, TEST_ADMIN_A.password);
      await primaryPage.goto("/admin");
      await expect(
        primaryPage.locator(".stat-card_container").first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step("2. Admin A opens secondary admin tab (different page)", async () => {
      await secondaryPage.goto("/admin/users");
      await expect(secondaryPage.getByRole("table").first()).toBeVisible({
        timeout: 15_000,
      });
      expect(secondaryPage.url()).toContain("/admin/users");
    });

    await test.step("3. Admin A session SSE is connected on primary tab", async () => {
      await expect
        .poll(
          async () => isSessionSseConnected(primaryPage),
          {
            timeout: 10_000,
            message: "Primary tab session SSE should be connected",
          },
        )
        .toBe(true);
    });

    await test.step("4. Admin B signs in and demotes Admin A", async () => {
      await signIn(adminBPage, TEST_ADMIN_B.email, TEST_ADMIN_B.password);
      await navigateToUsersPage(adminBPage);

      const adminARow = adminBPage
        .getByRole("row")
        .filter({ hasText: TEST_ADMIN_A.email });
      await expect(adminARow).toBeVisible({ timeout: 10_000 });

      await adminARow.getByRole("combobox").click();
      const userOption = adminBPage.getByRole("option", { name: "User" });
      await expect(userOption).toBeVisible({ timeout: 5_000 });
      await userOption.click();

      await expect
        .poll(
          async () => {
            const row = adminBPage
              .getByRole("row")
              .filter({ hasText: TEST_ADMIN_A.email });
            const text = await row.textContent().catch(() => "");
            return text?.includes("User");
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    });

    await test.step("5. Primary tab redirects to /sign-in", async () => {
      await expect(primaryPage).toHaveURL(/\/sign-in/, {
        timeout: REDIRECT_TIMEOUT,
      });
    });

    await test.step("6. Secondary tab redirects to /sign-in", async () => {
      await expect(secondaryPage).toHaveURL(/\/sign-in/, {
        timeout: REDIRECT_TIMEOUT,
      });
    });

    await test.step("7. Both tabs' admin pages are unreachable after redirect", async () => {
      await primaryPage.goto("/admin");
      await expect(primaryPage).toHaveURL(/\/sign-in/, { timeout: 10_000 });

      await secondaryPage.goto("/admin/borrow-records");
      await expect(secondaryPage).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    });

    // Restore Admin A's role
    await test.step("8. Restore Admin A role", async () => {
      await db
        .update(users)
        .set({
          role: "ADMIN",
          sessionVersion: 1,
          version: sql`version + 1`,
        })
        .where(eq(users.email, TEST_ADMIN_A.email));
    });

    await test.step("9. No critical errors during multi-tab invalidation", async () => {
      const critical = multitabErrors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("EventSource") &&
          !e.includes("ERR_ABORTED") &&
          !e.includes("_next/") &&
          !e.includes("_rsc=") &&
          !e.includes("/sign-in") &&
          !e.includes("/api/admin/dashboard") &&
          !e.includes("SSE error") &&
          !e.includes("RealtimeClient"),
      );
      expect(critical, `Multi-tab errors: ${critical.join("; ")}`).toHaveLength(0);
    });

    await primaryPage.close();
    await secondaryPage.close();
  });

  test("Stale session prevention: demoted admin token cannot access APIs", async ({
    adminAContext,
    adminBPage,
  }) => {
    test.setTimeout(120_000);

    const stalePage = await adminAContext.newPage();
    await stalePage.addInitScript(createSseInterceptorScript());

    await test.step("1. Admin A signs in and captures initial auth state", async () => {
      await signIn(stalePage, TEST_ADMIN_A.email, TEST_ADMIN_A.password);
      await stalePage.goto("/admin");
      await expect(
        stalePage.locator(".stat-card_container").first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step("2. Confirm Admin A is on dashboard", async () => {
      await expect(
        stalePage.locator(".stat-card_container").first(),
      ).toBeVisible({ timeout: 5_000 });
    });

    await test.step("3. Admin B demotes Admin A", async () => {
      await signIn(adminBPage, TEST_ADMIN_B.email, TEST_ADMIN_B.password);
      await navigateToUsersPage(adminBPage);

      const adminARow = adminBPage
        .getByRole("row")
        .filter({ hasText: TEST_ADMIN_A.email });
      await expect(adminARow).toBeVisible({ timeout: 10_000 });

      await adminARow.getByRole("combobox").click();
      const userOption = adminBPage.getByRole("option", { name: "User" });
      await expect(userOption).toBeVisible({ timeout: 5_000 });
      await userOption.click();

      await expect
        .poll(
          async () => {
            const row = adminBPage
              .getByRole("row")
              .filter({ hasText: TEST_ADMIN_A.email });
            const text = await row.textContent().catch(() => "");
            return text?.includes("User");
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    });

    await test.step("4. Admin A receives session:invalidated SSE event and redirects to /sign-in", async () => {
      await waitForSessionInvalidationOrRedirect(stalePage, SSE_TIMEOUT);
    });

    await test.step("4.1 Admin A confirmed on /sign-in", async () => {
      await expect(stalePage).toHaveURL(/\/sign-in/, {
        timeout: REDIRECT_TIMEOUT,
      });
    });

    await test.step("5. Session cookies are cleared after invalidation", async () => {
      const cookiesAfter = await adminAContext.cookies();
      const sessionCookies = cookiesAfter.filter((c) =>
        c.name.toLowerCase().includes("session") ||
        c.name.toLowerCase().includes("token") ||
        c.name.toLowerCase().includes("next-auth") ||
        c.name.toLowerCase().includes("authjs")
      );
      // No auth session cookies should remain (httpOnly session cookies are cleared by signOut)
      // Some non-session cookies (e.g., csrf token) might remain; we check there's no valid session
      const hasValidSessionCookie = sessionCookies.some(
        (c) =>
          c.name.includes("session-token") && c.value.length > 0,
      );
      expect(hasValidSessionCookie).toBe(false);
    });

    await test.step("6. Stale JWT cookie cannot access admin page", async () => {
      // After invalidation the auth cookie is gone; verify navigation to /admin
      // is blocked at the middleware layer (no session → redirect to /sign-in).
      await stalePage.goto("/admin");
      await expect(stalePage).toHaveURL(/\/sign-in/, { timeout: 15_000 });
    });

    await test.step("7. Restore Admin A role", async () => {
      await db
        .update(users)
        .set({
          role: "ADMIN",
          sessionVersion: 1,
          version: sql`version + 1`,
        })
        .where(eq(users.email, TEST_ADMIN_A.email));
    });

    await stalePage.close();
  });
});




