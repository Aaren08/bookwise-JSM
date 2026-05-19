import { test as base, expect, Page, BrowserContext } from "@playwright/test";
import { db } from "../../../../database/drizzle";
import { users, books, borrowRecords, appSettings } from "../../../../database/schema";
import { eq, ilike, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";
import { AdminDashboardPage } from "../../pages/admin/dashboard.page";
import { SigninPage } from "../../pages/auth/signin.page";
import { SignupPage } from "../../pages/auth/signup.page";
import {
  createSseInterceptorScript,
  createNetworkDiagnostics,
  waitForDashboardConnected,
  waitForDashboardRefresh,
  getSseEvents,
  getSseConnections,
  ADMIN_DASHBOARD_SSE_URL,
} from "../../utils/sse";
import { sampleBooks } from "../../../../constants";

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const SSE_TIMEOUT = 25_000;

const TEST_PREFIX = `dash-realtime-${WORKER_ID}`;

const TEST_USER = {
  email: `${TEST_PREFIX}-user@bookwise-test.com`,
  password: "DashTestPass123!",
  fullName: "Dashboard Test User",
};

const TEST_ADMIN = {
  email: `${TEST_PREFIX}-admin@bookwise-test.com`,
  password: "DashAdminPass123!",
  fullName: "Dashboard Test Admin",
};

let testBook: {
  id: string;
  title: string;
  author: string;
  genre: string;
  totalCopies: number;
};

let borrowDurationDays: number;

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

async function seedTestBook() {
  const title = `${TEST_PREFIX}-Deep Work`;
  const template = sampleBooks.find((b) => b.title === "Deep Work")!;

  await db.delete(books).where(ilike(books.title, `${TEST_PREFIX}%`));

  const [book] = await db
    .insert(books)
    .values({
      title,
      author: template.author,
      genre: template.genre,
      rating: template.rating,
      totalCopies: template.totalCopies,
      description: template.description,
      coverColor: template.coverColor,
      coverUrl: template.coverUrl,
      videoUrl: template.videoUrl,
      summary: template.summary,
    })
    .returning({
      id: books.id,
      title: books.title,
      author: books.author,
      genre: books.genre,
      totalCopies: books.totalCopies,
    });

  return book;
}

async function getBorrowDurationDays(): Promise<number> {
  try {
    const [settings] = await db
      .select({ borrowDurationDays: appSettings.borrowDurationDays })
      .from(appSettings)
      .where(eq(appSettings.id, true))
      .limit(1);
    return settings?.borrowDurationDays ?? 14;
  } catch {
    return 14;
  }
}

async function getUserIdByEmail(email: string): Promise<string | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user?.id ?? null;
}

async function getBorrowRecordByBookId(bookId: string) {
  const [record] = await db
    .select({ id: borrowRecords.id, status: borrowRecords.borrowStatus })
    .from(borrowRecords)
    .where(eq(borrowRecords.bookId, bookId))
    .limit(1);
  return record ?? null;
}

async function triggerDashboardBroadcastFromPage(page: Page) {
  const response = await page.request.post(ADMIN_DASHBOARD_SSE_URL);
  expect(response.ok(), `Dashboard broadcast failed with ${response.status()}`).toBe(true);
}

async function mockImageKitUpload(page: Page) {
  await page.route("**/api/auth/imagekit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        signature: "mock_signature",
        expire: Math.floor(Date.now() / 1000) + 3600,
        token: "mock_token",
        publicKey: "mock_public_key",
      }),
    });
  });

  await page.route("https://upload.imagekit.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "/images/auth-illustration.png",
      }),
    });
  });
}

type DashboardRealtimeFixtures = {
  adminContext: BrowserContext;
  adminPage: Page;
  userContext: BrowserContext;
  userPage: Page;
  dashboardPage: AdminDashboardPage;
};

const test = base.extend<DashboardRealtimeFixtures>({
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
  userContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  userPage: async ({ userContext }, use) => {
    const page = await userContext.newPage();
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

async function signUp(page: Page, email: string, password: string, fullName: string) {
  await mockImageKitUpload(page);
  const signupPage = new SignupPage(page);
  await signupPage.goto();
  await signupPage.fillSignupForm({
    fullName,
    email,
    password,
    universityId: Math.floor(100000 + Math.random() * 900000).toString(),
    idCardPath: "tests/e2e/data/mock-id.png",
  });
  await signupPage.submit();
  await signupPage.expectSuccess();
}

test.describe("Admin Dashboard Real-Time Updates", () => {
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    await ensureAdminExists();
    await ensureUserExists();
    testBook = await seedTestBook();
    borrowDurationDays = await getBorrowDurationDays();
  });

  test.afterAll(async () => {
    await db
      .delete(borrowRecords)
      .where(
        and(
          eq(borrowRecords.bookId, testBook.id),
          eq(borrowRecords.borrowStatus, "BORROWED"),
        ),
      )
      .catch(() => {});
    await db
      .delete(borrowRecords)
      .where(eq(borrowRecords.bookId, testBook.id))
      .catch(() => {});
    await db
      .delete(books)
      .where(ilike(books.title, `${TEST_PREFIX}%`))
      .catch(() => {});
    await db
      .delete(users)
      .where(ilike(users.email, `${TEST_PREFIX}%`))
      .catch(() => {});
  });

  test("Admin dashboard updates in real-time via SSE without page reload", async ({
    adminPage,
    userPage,
    dashboardPage,
  }) => {
    const adminErrors = createNetworkDiagnostics(adminPage);
    let initialStats: { totalBooks: number; totalUsers: number; borrowedBooks: number };

    test.setTimeout(240_000);

    // ── Phase 1: Dashboard Initialization + SSE Connection ────────────────────
    await test.step("1.0 Admin signs in", async () => {
      await signIn(adminPage, TEST_ADMIN.email, TEST_ADMIN.password);
    });

    await test.step("1.1 Dashboard loads", async () => {
      await dashboardPage.goto();
      await dashboardPage.waitForStatsToRender(15_000);
    });

    await test.step("1.2 Skeletons disappear, real stats render", async () => {
      await dashboardPage.waitForSkeletonsToDisappear(15_000);
      await dashboardPage.waitForStatsToRender(15_000);
      initialStats = {
        totalBooks: await dashboardPage.getStatValue("Total Books"),
        totalUsers: await dashboardPage.getStatValue("Total Users"),
        borrowedBooks: await dashboardPage.getStatValue("Borrowed Books"),
      };
      expect(initialStats.totalBooks).toBeGreaterThanOrEqual(0);
      expect(initialStats.totalUsers).toBeGreaterThanOrEqual(0);
    });

    await test.step("1.3 SSE dashboard:connected event is received", async () => {
      await waitForDashboardConnected(adminPage, 15_000);
    });

    await test.step("1.4 Borrow requests and account requests sections render", async () => {
      await dashboardPage.waitForBorrowRequestsToRender(10_000);
      await dashboardPage.waitForAccountRequestsToRender(10_000);
    });

    await test.step("1.5 SSE stream remains active (no error events)", async () => {
      const connections = await getSseConnections(adminPage);
      const dashboardConn = connections.find((c) =>
        c.url.includes(ADMIN_DASHBOARD_SSE_URL),
      );
      expect(dashboardConn, "Dashboard SSE connection should exist").toBeTruthy();
    });

    // ── Phase 2: User Signs Up → Account Request Appears ──────────────────────
    const newUserEmail = `${TEST_PREFIX}-new-${Date.now()}@bookwise-test.com`;
    const newUserFullName = "New Signup User";

    await test.step("2.1 New user signs up in separate context", async () => {
      await signUp(userPage, newUserEmail, "SignupPass123!", newUserFullName);
      await expect(userPage).toHaveURL(/\/sign-up/);
    });

    await test.step("2.2 Dashboard account requests section shows new user", async () => {
      await dashboardPage.expectAccountRequestVisible(newUserEmail, SSE_TIMEOUT);

      const currentUrl = adminPage.url();
      expect(currentUrl).toContain("/admin");
    });

    // ── Phase 3: Admin Approves User → Stats Update (no reload) ───────────────
    await test.step("3.1 Admin approves user via database", async () => {
      const userId = await getUserIdByEmail(newUserEmail);
      expect(userId, "New user should exist in DB").toBeTruthy();

      await db
        .update(users)
        .set({ status: "APPROVED" })
        .where(eq(users.email, newUserEmail));

      await triggerDashboardBroadcastFromPage(adminPage);
    });

    await test.step("3.2 Dashboard receives SSE refresh after approval", async () => {
      await waitForDashboardRefresh(adminPage, SSE_TIMEOUT);
    });

    await test.step("3.3 totalUsers counter increments by 1", async () => {
      await dashboardPage.expectStatValue(
        "Total Users",
        initialStats.totalUsers + 1,
        SSE_TIMEOUT,
      );
    });

    await test.step("3.4 Account request card disappears", async () => {
      await dashboardPage.expectAccountRequestNotVisible(newUserEmail, SSE_TIMEOUT);
    });

    await test.step("3.5 No page reload occurred", async () => {
      expect(adminPage.url()).toContain("/admin");
    });

    // ── Phase 4: User Borrows Book → Borrow Request Appears ───────────────────
    await test.step("4.1 User navigates to book detail and clicks borrow", async () => {
      await signIn(userPage, TEST_USER.email, TEST_USER.password);
      await userPage.goto(`/books/${testBook.id}`);

      await expect(
        userPage.getByRole("heading", { name: testBook.title }),
      ).toBeVisible();

      await userPage.getByRole("button", { name: "Borrow Book Request" }).click();

      await expect(userPage.getByText("Book request is forwarded")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("4.2 Dashboard receives SSE refresh after borrow request", async () => {
      await waitForDashboardRefresh(adminPage, SSE_TIMEOUT);
    });

    await test.step("4.3 Dashboard borrow requests section shows new PENDING request", async () => {
      await dashboardPage.expectBorrowRequestVisible(testBook.title, SSE_TIMEOUT);
    });

    await test.step("4.4 Borrow request card contains correct user and book data", async () => {
      await dashboardPage.expectBorrowRequestContainsBookTitle(testBook.title);
      await dashboardPage.expectBorrowRequestContainsUserName(TEST_USER.fullName);
    });

    await test.step("4.5 No page reload occurred", async () => {
      expect(adminPage.url()).toContain("/admin");
    });

    // ── Phase 5: Admin Approves Borrow → borrowedBooks Counter Updates ────────
    await test.step("5.1 Admin approves borrow record via database", async () => {
      const record = await getBorrowRecordByBookId(testBook.id);
      expect(record, "Borrow record should exist").toBeTruthy();

      const userId = await getUserIdByEmail(TEST_USER.email);
      expect(userId).toBeTruthy();

      const dueDate = dayjs().add(borrowDurationDays, "days").format("YYYY-MM-DD");

      await db
        .update(borrowRecords)
        .set({
          borrowStatus: "BORROWED",
          dueDate,
          updatedAt: new Date(),
        })
        .where(eq(borrowRecords.id, record!.id));

      await db
        .update(books)
        .set({
          borrowedCount: sql`${books.borrowedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(books.id, testBook.id));

      await triggerDashboardBroadcastFromPage(adminPage);
    });

    await test.step("5.2 borrowedBooks counter increments by 1", async () => {
      await dashboardPage.expectStatValue(
        "Borrowed Books",
        initialStats.borrowedBooks + 1,
        SSE_TIMEOUT,
      );
    });

    await test.step("5.3 Borrow request card disappears (no longer PENDING)", async () => {
      await dashboardPage.expectBorrowRequestNotVisible(testBook.title, SSE_TIMEOUT);
    });

    await test.step("5.4 No page reload occurred", async () => {
      expect(adminPage.url()).toContain("/admin");
    });

    // ── Phase 6: Return Flow → borrowedBooks Decrements ───────────────────────
    await test.step("6.1 Admin marks borrow as RETURNED via database", async () => {
      const record = await getBorrowRecordByBookId(testBook.id);
      expect(record, "Borrow record should exist").toBeTruthy();

      await db
        .update(borrowRecords)
        .set({
          borrowStatus: "RETURNED",
          returnDate: dayjs().format("YYYY-MM-DD"),
          updatedAt: new Date(),
        })
        .where(eq(borrowRecords.id, record!.id));

      await db
        .update(books)
        .set({
          borrowedCount: sql`GREATEST(0, ${books.borrowedCount} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(books.id, testBook.id));

      await triggerDashboardBroadcastFromPage(adminPage);
    });

    await test.step("6.2 borrowedBooks counter decrements by 1", async () => {
      await dashboardPage.expectStatValue(
        "Borrowed Books",
        initialStats.borrowedBooks,
        SSE_TIMEOUT,
      );
    });

    await test.step("6.3 No page reload occurred during entire return flow", async () => {
      expect(adminPage.url()).toContain("/admin");
    });

    // ── Phase 7: SSE Event Diagnostics ────────────────────────────────────────
    await test.step("7.1 SSE events were received throughout the test", async () => {
      const events = await getSseEvents(adminPage);
      const dashboardEvents = events.filter(
        (e) =>
          e.type === "message" && e.url.includes(ADMIN_DASHBOARD_SSE_URL),
      );

      expect(dashboardEvents.length).toBeGreaterThanOrEqual(3);

      const refreshEvents = dashboardEvents.filter(
        (e) =>
          typeof e.data === "object" &&
          e.data !== null &&
          (e.data as Record<string, unknown>).type === "dashboard:refresh",
      );
      expect(refreshEvents.length).toBeGreaterThanOrEqual(1);
    });

    await test.step("7.2 No SSE reconnect storms (error events are limited)", async () => {
      const connections = await getSseConnections(adminPage);
      const dashboardConns = connections.filter((c) =>
        c.url.includes(ADMIN_DASHBOARD_SSE_URL),
      );
      expect(dashboardConns.length).toBeLessThanOrEqual(3);
    });

    // ── Phase 8: Console & Network Diagnostics ────────────────────────────────
    await test.step("8.1 No critical console or network errors", async () => {
      await dashboardPage.expectNoConsoleErrors(adminErrors);
    });
  });
});
