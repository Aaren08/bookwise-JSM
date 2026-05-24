import { test, expect } from "../../fixtures/resilience-fixture";
import { SigninPage } from "../../pages/auth/signin.page";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `nf-resil-${WORKER_ID}`;

const TEST_USER = {
  email: `${TEST_PREFIX}-user@bookwise-test.com`,
  password: "NotFoundTest1!",
  fullName: "Not Found Test User",
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

test.describe("404 / not-found Behavior", () => {
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

  test("public unknown routes show custom not-found and remain navigable", async ({
    page,
    signinPage,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in as USER", async () => {
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Navigate to a non-existent public route", async () => {
      await page.goto("/this-route-does-not-exist");
    });

    await test.step("3. Custom not-found UI renders", async () => {
      await expect(page.getByText("Page not found")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByText(/Sorry, the page you are looking for does not exist/),
      ).toBeVisible();
    });

    await test.step("4. App shell / layout remains intact", async () => {
      const header = page.locator("header");
      await expect(header).toBeVisible();
    });

    await test.step("5. Navigation still works after visiting not-found", async () => {
      const homeLink = page.getByRole("link", { name: /BookWise/i }).first();
      if (await homeLink.isVisible().catch(() => false)) {
        await homeLink.click();
        await expect(page).not.toHaveURL(/this-route-does-not-exist/);
      } else {
        await page.goto("/");
        await expect(page).not.toHaveURL(/this-route-does-not-exist/);
      }
    });

    await test.step("6. No React crash or uncaught exceptions", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "ERR_ABORTED",
        "_next/",
        "_rsc=",
      ]);
    });
  });

  test("invalid resource ID (non-existent book) shows not-found", async ({
    page,
    signinPage,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in", async () => {
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Navigate to a book with non-existent UUID", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000000";
      await page.goto(`/books/${nonExistentId}`);
    });

    await test.step("3. Custom not-found UI renders for invalid book", async () => {
      await expect(page.getByText("Page not found")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("4. No crashes, no uncaught errors", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "ERR_ABORTED",
        "_next/",
        "_rsc=",
      ]);
    });
  });

  test("invalid book ID format returns not-found", async ({
    page,
    signinPage,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in", async () => {
      await signinPage.goto();
      await signinPage.signIn(TEST_USER.email, TEST_USER.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Navigate to book with invalid ID format", async () => {
      await page.goto("/books/not-a-valid-uuid");
    });

    await test.step("3. Zod validation triggers notFound()", async () => {
      await expect(page.getByText("Page not found")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("4. Back navigation works", async () => {
      await page.goBack();
      await expect(page).not.toHaveURL(/\/books/);
    });

    await test.step("5. No violations", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "_next/",
        "_rsc=",
      ]);
    });
  });
});

test.describe("Admin not-found Routes", () => {
  test.setTimeout(120_000);
  let adminContext: { email: string; password: string };

  test.beforeAll(async () => {
    const adminEmail = `${TEST_PREFIX}-nested-admin@bookwise-test.com`;
    const adminPassword = "NestedAdmin1!";
    adminContext = { email: adminEmail, password: adminPassword };

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    if (existing.length === 0) {
      const hashed = await bcrypt.hash(adminPassword, 10);
      await db.insert(users).values({
        fullName: "Nested Admin",
        email: adminEmail,
        password: hashed,
        status: "APPROVED",
        role: "ADMIN",
      });
    }
  });

  test("nested admin unknown route shows admin-specific not-found", async ({
    adminPage,
    consoleMonitor,
  }) => {
    await test.step("1. Admin signs in", async () => {
      const signinPage = new SigninPage(adminPage);
      await signinPage.goto();
      await signinPage.signIn(adminContext.email, adminContext.password);
      await expect(adminPage).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Navigate to non-existent admin route", async () => {
      await adminPage.goto("/admin/non-existent-page");
    });

    await test.step("3. Admin-specific not-found UI renders", async () => {
      await expect(adminPage.getByText("Page not found")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        adminPage.getByText(
          /Sorry, the page you are looking for does not exist/,
        ),
      ).toBeVisible();
    });

    await test.step("4. Admin layout remains intact (sidebar visible)", async () => {
      const sidebar = adminPage.locator(".admin-sidebar");
      await expect(sidebar).toBeVisible({ timeout: 5_000 });
    });

    await test.step("5. Navigation to a valid admin route still works", async () => {
      await adminPage.goto("/admin");
      await expect(adminPage).toHaveURL(/\/admin$/);
    });

    await test.step("6. No critical errors", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "_next/",
        "_rsc=",
        "/sign-in",
        "/admin",
        "CSS",
      ]);
    });
  });

  test("deep admin unknown route under existing namespace", async ({
    adminPage,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in as admin", async () => {
      const signinPage = new SigninPage(adminPage);
      await signinPage.goto();
      await signinPage.signIn(adminContext.email, adminContext.password);
      await expect(adminPage).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Navigate to deep unknown admin route", async () => {
      await adminPage.goto("/admin/users/some-nonexistent-action");
    });

    await test.step("3. Admin not-found renders", async () => {
      await expect(adminPage.getByText("Page not found")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("4. Admin sidebar still visible", async () => {
      const sidebar = adminPage.locator(".admin-sidebar");
      await expect(sidebar).toBeVisible({ timeout: 5_000 });
    });

    await test.step("5. Navigable afterward", async () => {
      await adminPage.goto("/admin/users");
      await expect(adminPage.getByRole("table").first()).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("6. No violations", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "_next/",
        "_rsc=",
        "/sign-in",
        "/admin",
      ]);
    });
  });

  test("browser back from admin not-found works", async ({
    adminPage,
    consoleMonitor,
  }) => {
    await test.step("1. Sign in as admin", async () => {
      const signinPage = new SigninPage(adminPage);
      await signinPage.goto();
      await signinPage.signIn(adminContext.email, adminContext.password);
      await expect(adminPage).not.toHaveURL(/\/sign-in/);
    });

    await test.step("2. Visit valid admin page", async () => {
      await adminPage.goto("/admin");
      await expect(adminPage).toHaveURL(/\/admin$/);
    });

    await test.step("3. Navigate to bad admin route", async () => {
      await adminPage.goto("/admin/bad-route");
      await expect(adminPage.getByText("Page not found")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("4. Browser back returns to valid page", async () => {
      await adminPage.goBack();
      await expect(adminPage).toHaveURL(/\/admin$/);
    });

    await test.step("5. No violations", async () => {
      consoleMonitor.assertNoCriticalViolations([
        "favicon",
        "AbortError",
        "_next/",
        "_rsc=",
        "/sign-in",
        "/admin",
      ]);
    });
  });
});
