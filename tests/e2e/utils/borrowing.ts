import { Page } from "@playwright/test";
import { db } from "../../../database/drizzle";
import { books, users, borrowRecords } from "../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";
import { SigninPage } from "../pages/auth/signin.page";
import { sampleBooks } from "../../../constants";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const workerIndex = process.env.TEST_WORKER_INDEX ?? "0";

export const TEST_BOOK_TITLE_PREFIX = `e2e-borrow-${workerIndex}-`;

export const TEST_USER = {
  email: `borrow-e2e-user-${workerIndex}@bookwise-test.com`,
  password: "BorrowTestPass123!",
  fullName: "Borrow E2E User",
};

export const TEST_ADMIN = {
  email: `borrow-e2e-admin-${workerIndex}@bookwise-test.com`,
  password: "BorrowAdminPass123!",
  fullName: "Borrow E2E Admin",
};

// ---------------------------------------------------------------------------
// Sign in helper
// ---------------------------------------------------------------------------

export async function signIn(page: Page, email: string, password: string) {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(email, password);
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

export async function ensureUserExists() {
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

export async function ensureAdminExists() {
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

export async function seedTestBook(): Promise<{
  id: string;
  title: string;
  author: string;
  genre: string;
  totalCopies: number;
}> {
  const title = `${TEST_BOOK_TITLE_PREFIX}Deep Work`;
  const template = sampleBooks.find((b) => b.title === "Deep Work")!;

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
    .returning({ id: books.id, title: books.title, author: books.author, genre: books.genre, totalCopies: books.totalCopies });

  return book;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupTestBook() {
  await db
    .delete(books)
    .where(ilike(books.title, `${TEST_BOOK_TITLE_PREFIX}%`));
}

export async function cleanupBorrowRecord(recordId: string) {
  await db.delete(borrowRecords).where(eq(borrowRecords.id, recordId));
}

// ---------------------------------------------------------------------------
// SSE / realtime wait
// ---------------------------------------------------------------------------

export async function waitForAvailabilityToDecrease(
  page: Page,
  initialCount: number,
  timeout = 20000,
) {
  const expected = initialCount - 1;
  await page.waitForFunction(
    (expectedVal: number) => {
      const el = document.querySelector(".book-overview");
      if (!el) return false;
      const text = el.textContent || "";
      const match = text.match(/Available Books:\s*(\d+)/);
      return match && parseInt(match[1], 10) === expectedVal;
    },
    expected,
    { timeout },
  );
}

export async function waitForAvailabilityToReturn(
  page: Page,
  initialCount: number,
  timeout = 20000,
) {
  await page.waitForFunction(
    (expectedVal: number) => {
      const el = document.querySelector(".book-overview");
      if (!el) return false;
      const text = el.textContent || "";
      const match = text.match(/Available Books:\s*(\d+)/);
      return match && parseInt(match[1], 10) === expectedVal;
    },
    initialCount,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// Receipt helpers
// ---------------------------------------------------------------------------

export function getExpectedDueDate(borrowDate: Date, durationDays: number): string {
  return dayjs(borrowDate).add(durationDays, "days").format("DD/MM/YYYY");
}

export function getBorrowDateFormatted(date: Date): string {
  return dayjs(date).format("DD/MM/YYYY");
}

// ---------------------------------------------------------------------------
// Admin table helpers
// ---------------------------------------------------------------------------

/**
 * Find the borrow records table row containing the given book title.
 * Returns a locator scoped to that row.
 */
export function findBorrowRecordRow(page: Page, bookTitle: string) {
  return page.getByRole("row").filter({ hasText: bookTitle });
}
