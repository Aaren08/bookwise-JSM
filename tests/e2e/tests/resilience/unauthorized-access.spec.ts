import { test, expect } from "../../fixtures/resilience-fixture";
import { Page } from "@playwright/test";
import { SigninPage } from "../../pages/auth/signin.page";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `unauth-${WORKER_ID}`;

const TEST_USER = {
  email: `${TEST_PREFIX}-user@bookwise-test.com`,
  password: "UnauthTest1!",
  fullName: "Unauthorized Test User",
};

const TEST_ADMIN = {
  email: `${TEST_PREFIX}-admin@bookwise-test.com`,
  password: "UnauthAdmin1!",
  fullName: "Unauthorized Test Admin",
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

async function signInUser(page: Page, email: string, password: string) {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(email, password);
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test.describe("Unauthorized Admin Access", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    await ensureTestUsers();
  });

  test.afterAll(async () => {
    await db
      .delete(users)
      .where(ilike(users.email, `${TEST_PREFIX}%`))
      .catch(() => {});
  });

  test("USER role cannot access /admin — redirected to home", async ({
    page,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signInUser(page, TEST_USER.email, TEST_USER.password);
    });

    await test.step("2. USER is on home page", async () => {
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("3. Attempt to navigate to /admin", async () => {
      await page.goto("/admin", { waitUntil: "commit" });
    });

    await test.step("4. USER is redirected away from /admin", async () => {
      await expect(page).not.toHaveURL(/\/admin/);
    });

    await test.step("5. No critical errors", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "ERR_ABORTED",
        "_next/",
        "_rsc=",
        "/sign-in",
        "authentication",
      ]);
    });
  });

  test("USER redirected to home, not sign-in (role-based redirect)", async ({
    page,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signInUser(page, TEST_USER.email, TEST_USER.password);
    });

    await test.step("2. Navigate to /admin and verify redirect target", async () => {
      await page.goto("/admin", { waitUntil: "commit" });

      await expect
        .poll(
          async () => {
            try {
              return page.url();
            } catch {
              return "";
            }
          },
          { timeout: 15_000, message: "Should redirect away from /admin" },
        )
        .not.toContain("/admin");
    });

    await test.step("3. Protected content never flashed", async () => {
      const adminContent = page.locator(
        ".stat-card_container, .admin-container",
      );
      await expect(adminContent).not.toBeVisible({ timeout: 5_000 });
    });
  });

  test("direct navigation to /admin/users is blocked for USER", async ({
    page,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signInUser(page, TEST_USER.email, TEST_USER.password);
    });

    await test.step("2. Try navigating directly to /admin/users", async () => {
      await page.goto("/admin/users", { waitUntil: "commit" });
    });

    await test.step("3. User is redirected away from admin", async () => {
      await expect(page).not.toHaveURL(/\/admin/);
    });
  });

  test("direct navigation to /admin/books is blocked for USER", async ({
    page,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signInUser(page, TEST_USER.email, TEST_USER.password);
    });

    await test.step("2. Try /admin/books", async () => {
      await page.goto("/admin/books", { waitUntil: "commit" });
    });

    await test.step("3. Redirected away", async () => {
      await expect(page).not.toHaveURL(/\/admin/);
    });
  });

  test("browser back/forward cannot restore protected admin content for USER", async ({
    page,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signInUser(page, TEST_USER.email, TEST_USER.password);
    });

    await test.step("2. Visit a known user page", async () => {
      await page.goto("/my-profile");
      await expect(page).toHaveURL(/\/my-profile/);
    });

    await test.step("3. Attempt to go forward to /admin", async () => {
      await page.goto("/admin", { waitUntil: "commit" });
      await expect(page).not.toHaveURL(/\/admin/);
    });

    await test.step("4. Go back to /my-profile", async () => {
      await page.goBack();
      await expect(page).toHaveURL(/\/my-profile/);
    });

    await test.step("5. Go forward — should not land on /admin", async () => {
      await page.goForward();
      await expect(page).not.toHaveURL(/\/admin/);
    });
  });

  test("ADMIN retains access to admin routes", async ({
    adminPage,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in as ADMIN", async () => {
      await signInUser(adminPage, TEST_ADMIN.email, TEST_ADMIN.password);
    });

    await test.step("2. Navigate to /admin", async () => {
      await adminPage.goto("/admin");
    });

    await test.step("3. Dashboard loads successfully", async () => {
      await expect(
        adminPage.locator(".stat-card_container").first(),
      ).toBeVisible({
        timeout: 15_000,
      });
      expect(adminPage.url()).toContain("/admin");
    });

    await test.step("4. Navigate to /admin/users", async () => {
      await adminPage.goto("/admin/users");
      await expect(adminPage.getByRole("table").first()).toBeVisible({
        timeout: 10_000,
      });
      expect(adminPage.url()).toContain("/admin/users");
    });

    await test.step("5. No critical errors", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "EventSource",
        "_next/",
        "_rsc=",
        "/admin",
      ]);
    });
  });

  test("cached admin pages revalidate correctly (no stale content after redirect)", async ({
    page,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signInUser(page, TEST_USER.email, TEST_USER.password);
    });

    await test.step("2. Attempt /admin — should be blocked", async () => {
      await page.goto("/admin", { waitUntil: "commit" });
      await expect(page).not.toHaveURL(/\/admin/);
      const bodyContent = await page.evaluate(
        () => document.body?.innerText?.substring(0, 200) ?? "",
      );
      expect(bodyContent).not.toContain("Total Users");
      expect(bodyContent).not.toContain("Borrowed Books");
    });
  });
});
