import { test as base } from "./base-fixture";
import { db } from "../../../database/drizzle";
import { books, users } from "../../../database/schema";
import { eq, ilike } from "drizzle-orm";
import { SearchPage } from "../pages/search/search.page";
import { SigninPage } from "../pages/auth/signin.page";
import { sampleBooks } from "../../../constants";
import bcrypt from "bcryptjs";

type SearchFixtures = {
  /** Unique string used as a title prefix for every book this test inserts.
   *  Guarantees zero cache collisions with other parallel tests because
   *  the axe `searchBooksCached` cache key includes the query string. */
  searchTestId: string;
  /** Page Object Model for the /search route. */
  searchPage: SearchPage;
};

export const test = base.extend<SearchFixtures>({
  searchTestId: [
    async ({}, use) => {
      // Short, readable, statistically unique per test invocation.
      const id = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      await use(id);
    },
    { scope: "test" },
  ],
  searchPage: [
    async ({ page }, use) => {
      await use(new SearchPage(page));
    },
    { scope: "test" },
  ],
});

export { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
//  Test user credentials — reused across all search tests in a worker.
// ---------------------------------------------------------------------------

const _workerIdx = process.env.TEST_WORKER_INDEX ?? "0";

export const TEST_USER = {
  email: `search-e2e-user-${_workerIdx}@bookwise-test.com`,
  password: "TestPass123!",
  fullName: "Search E2E Test User",
};

// ---------------------------------------------------------------------------
//  Reusable seed / cleanup helpers
//  Called from test hooks — NOT mixed into fixtures so the developer sees
//  the explicit lifecycle.
// ---------------------------------------------------------------------------

export async function seedSearchBooks(
  testRunId: string,
  { includePagination = false, paginationCount = 0 } = {},
) {
  const seedData = sampleBooks.map((book) => {
    // Strip `id` (DB auto-generates it) and `availableCopies` (it is a
    // GENERATED ALWAYS AS column in Postgres — inserting it directly causes
    // an error or is silently ignored; the DB derives it automatically from
    // total_copies - borrowed_count - reserved_count).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, availableCopies, ...rest } = book;
    return {
      ...rest,
      title: `${testRunId}-${book.title}`,
    };
  });

  if (includePagination && paginationCount > 0) {
    const extraBooks = Array.from({ length: paginationCount }, (_, i) => {
      const book = sampleBooks[i % sampleBooks.length];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, availableCopies, ...rest } = book;
      return {
        ...rest,
        title: `${testRunId}-PageBook-${String(i + 1).padStart(3, "0")}`,
      };
    });
    seedData.push(...extraBooks);
  }

  await db.insert(books).values(seedData);
}

export async function cleanupSearchBooks(testRunId: string) {
  await db.delete(books).where(ilike(books.title, `${testRunId}%`));
}

// ---------------------------------------------------------------------------
//  Auth helpers
// ---------------------------------------------------------------------------

const signInCalled = new Set<string>();

export async function ensureTestUser() {
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
  }
}

/** Navigate to /sign-in, fill credentials, and wait for redirect to home. */
export async function signIn(page: import("@playwright/test").Page) {
  const workerIndex = process.env.TEST_WORKER_INDEX ?? "0";
  const key = `${workerIndex}-${TEST_USER.email}`;

  await ensureTestUser();

  if (!signInCalled.has(key)) {
    signInCalled.add(key);
  }

  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(TEST_USER.email, TEST_USER.password);
}
