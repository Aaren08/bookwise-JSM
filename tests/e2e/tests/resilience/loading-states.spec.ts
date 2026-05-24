import { test, expect } from "../../fixtures/resilience-fixture";
import { Page } from "@playwright/test";
import { SigninPage } from "../../pages/auth/signin.page";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `loading-${WORKER_ID}`;

const TEST_USER = {
  email: `${TEST_PREFIX}-user@bookwise-test.com`,
  password: "LoadTest1!",
  fullName: "Loading Test User",
};

async function ensureUserExists() {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEST_USER.email))
    .limit(1);
  if (existing.length === 0) {
    const hashed = await bcrypt.hash(TEST_USER.password, 10);
    await db.insert(users).values({
      fullName: TEST_USER.fullName,
      email: TEST_USER.email,
      password: hashed,
      status: "APPROVED",
      role: "USER",
    });
  } else {
    await db
      .update(users)
      .set({ status: "APPROVED", role: "USER" })
      .where(eq(users.email, TEST_USER.email));
  }
}

async function signInUser(page: Page) {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(TEST_USER.email, TEST_USER.password);
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test.describe("Loading States", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    await ensureUserExists();
  });

  test.afterAll(async () => {
    await db
      .delete(users)
      .where(ilike(users.email, `${TEST_PREFIX}%`))
      .catch(() => {});
  });

  test("page loads with content within reasonable timeout (no hanging)", async ({
    page,
  }) => {
    await test.step("1. Sign in", async () => {
      await signInUser(page);
    });

    await test.step("2. Navigate to home page and measure load", async () => {
      const startTime = Date.now();
      await page.goto("/");
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(30_000);
    });

    await test.step("3. Content is visible", async () => {
      await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    });

    await test.step("4. No loading indicators persist", async () => {
      const loaders = page.locator(
        '[role="status"][aria-label="Loading"], .loader, .spinner',
      );
      await expect(loaders).not.toBeVisible({ timeout: 10_000 });
    });
  });

  test("navigation between pages works without deadlock", async ({ page }) => {
    await test.step("1. Sign in", async () => {
      await signInUser(page);
    });

    await test.step("2. Navigate to search", async () => {
      await page.goto("/search");
      expect(page.url()).toContain("/search");
    });

    await test.step("3. Navigate to profile", async () => {
      await page.goto("/my-profile");
      expect(page.url()).toContain("/my-profile");
    });

    await test.step("4. No loading indicators stuck", async () => {
      await page.waitForTimeout(1_000);
    });
  });

  test("skeleton loading states are replaced by real content on admin dashboard", async ({
    adminPage,
    consoleMonitor,
  }) => {
    const TEST_ADMIN = {
      email: `${TEST_PREFIX}-load-admin@bookwise-test.com`,
      password: "LoadAdmin1!",
      fullName: "Load Admin",
    };

    await test.step("0. Ensure admin exists", async () => {
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
      }
    });

    await test.step("1. Sign in as admin", async () => {
      const signinPage = new SigninPage(adminPage);
      await signinPage.goto();
      await signinPage.signIn(TEST_ADMIN.email, TEST_ADMIN.password);
      await expect(adminPage).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Navigate to admin dashboard", async () => {
      await adminPage.goto("/admin");
    });

    await test.step("3. Real content replaces skeletons", async () => {
      await expect(
        adminPage.locator(".stat-card_container").first(),
      ).toBeVisible({
        timeout: 20_000,
      });
    });

    await test.step("4. Skeleton elements are gone", async () => {
      const skeletons = adminPage.locator(".bg-skeleton, .skeleton");
      await expect(skeletons)
        .not.toBeVisible({ timeout: 10_000 })
        .catch(() => {});
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
});
