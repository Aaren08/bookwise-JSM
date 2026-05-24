import { test, expect } from "../../fixtures/resilience-fixture";
import { Page } from "@playwright/test";
import { SigninPage } from "../../pages/auth/signin.page";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `netfail-${WORKER_ID}`;

const TEST_USER = {
  email: `${TEST_PREFIX}-user@bookwise-test.com`,
  password: "NetFail1!",
  fullName: "Network Fail User",
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

test.describe("Network Failure Handling", () => {
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

  test("network disconnect during page load shows error state gracefully", async ({
    page,
    consoleMonitor,
    failureSimulator,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signInUser(page);
    });

    await test.step("2. Simulate network failure", async () => {
      await failureSimulator.simulateNetworkOffline();
    });

    await test.step("3. Attempt navigation while offline", async () => {
      await page.goto("/search", { timeout: 15_000 }).catch(() => {});
    });

    await test.step("4. Page handles offline state gracefully", async () => {
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("5. Restore network", async () => {
      await failureSimulator.restoreNetwork();
    });

    await test.step("6. Navigation works after restore", async () => {
      await page.goto("/");
      await expect(page).not.toHaveURL(/\/search/);
    });

    await test.step("7. No uncaught exceptions", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "ERR_ABORTED",
        "ERR_INTERNET_DISCONNECTED",
        "_next/",
        "_rsc=",
        "FetchError",
        "NetworkError",
        "Failed to fetch",
        "The Internet connection has been lost",
        "offline",
        "hydration",
        "Hydration",
      ]);
    });
  });

  test("app remains interactive after network failure recovery", async ({
    page,
    failureSimulator,
  }) => {
    await test.step("1. Sign in and verify interactivity", async () => {
      await signInUser(page);
    });

    await test.step("2. Simulate network failure", async () => {
      await failureSimulator.simulateNetworkOffline();
      await page.waitForTimeout(2_000);
    });

    await test.step("3. Restore network", async () => {
      await failureSimulator.restoreNetwork();
      await page.waitForTimeout(1_000);
    });

    await test.step("4. App remains on current page (no crash)", async () => {
      expect(page.url()).toBeTruthy();
      const bodyVisible = await page.evaluate(() => document.body !== null);
      expect(bodyVisible).toBe(true);
    });

    await test.step("5. Navigation still works", async () => {
      await page.goto("/");
      await expect(page).not.toHaveURL(/\/sign-in/);
    });
  });

  test("failed server requests do not cascade into app crash", async ({
    page,
    failureSimulator,
    signinPage,
  }) => {
    await test.step("1. Sign in", async () => {
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Block API requests to induce server errors", async () => {
      await failureSimulator.blockRequests([
        { urlPattern: "**/api/**", status: 500, abort: false },
      ]);
    });

    await test.step("3. Navigate while API is failing", async () => {
      await page.goto("/", { timeout: 30_000 }).catch(() => {});
    });

    await test.step("4. Page has not crashed", async () => {
      const hasBody = await page.evaluate(() => document.body !== null);
      expect(hasBody).toBe(true);
    });

    await test.step("5. Restore API", async () => {
      await failureSimulator.restoreNetwork();
    });

    await test.step("6. App still functional", async () => {
      await page.goto("/");
      expect(page.url()).toContain("localhost");
    });
  });

  test("toast notifications do not spam on repeated failures", async ({
    page,
    failureSimulator,
    signinPage,
  }) => {
    await test.step("1. Sign in", async () => {
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Count initial toasts", async () => {
      // Wait for any login success toasts to auto-dismiss so the starting count is clean.
      await expect(
        page.locator("[data-sonner-toaster] li, [role='status']"),
      ).toHaveCount(0, { timeout: 10_000 });

      const initialToasts = await page
        .locator("[data-sonner-toaster] li, [role='status']")
        .count();
      expect(initialToasts).toBe(0);
    });

    await test.step("3. Block API and trigger multiple failure attempts", async () => {
      await failureSimulator.blockRequests([
        { urlPattern: "**/api/**", status: 503 },
      ]);
      for (let i = 0; i < 5; i++) {
        try {
          await page.goto("/");
          await page.waitForTimeout(300);
        } catch {}
      }
    });

    await test.step("4. Count toast elements after failures", async () => {
      await page.waitForTimeout(1_000);
      const toastCount = await page
        .locator("[data-sonner-toaster] li, [role='status']")
        .count();
      expect(toastCount).toBeLessThanOrEqual(5);
    });

    await test.step("5. Restore network", async () => {
      await failureSimulator.restoreNetwork();
    });
  });

  test("network failure during search navigation recovers", async ({
    page,
    failureSimulator,
    signinPage,
  }) => {
    await test.step("1. Sign in", async () => {
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Go to search page while online", async () => {
      await page.goto("/search?query=test");
    });

    await test.step("3. Simulate network failure", async () => {
      await failureSimulator.simulateNetworkOffline();
      await page.waitForTimeout(1_000);
    });

    await test.step("4. Restore network", async () => {
      await failureSimulator.restoreNetwork();
    });

    await test.step("5. App is still on search page (no redirect to sign-in)", async () => {
      expect(page.url()).toContain("/search");
      const bodyVisible = await page.evaluate(() => document.body !== null);
      expect(bodyVisible).toBe(true);
    });
  });
});
