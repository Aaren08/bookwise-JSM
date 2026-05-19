import { test, expect } from "../../fixtures/search-fixture";
import {
  seedSearchBooks,
  cleanupSearchBooks,
  signIn,
} from "../../fixtures/search-fixture";

test.describe("Book Search", () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page, searchTestId }) => {
    await signIn(page);
    await seedSearchBooks(searchTestId);
  });

  test.afterEach(async ({ searchTestId }) => {
    await cleanupSearchBooks(searchTestId);
  });

  test("DB insertion works correctly", async ({ searchTestId }) => {
    const { db } = await import("../../../../database/drizzle");
    const { books } = await import("../../../../database/schema");
    const { ilike } = await import("drizzle-orm");

    const insertedBooks = await db
      .select()
      .from(books)
      .where(ilike(books.title, `${searchTestId}%`));

    console.log("INSERTED BOOKS COUNT:", insertedBooks.length);
    if (insertedBooks.length > 0) {
      console.log("FIRST BOOK:", insertedBooks[0].title, insertedBooks[0].availableCopies);
    }
  });

  test("search by exact title returns the correct single result", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(`${searchTestId}-The Midnight Library`);

    try {
      await searchPage.expectSearchResults(searchTestId);
    } catch (e) {
      console.log("HTML:", await searchPage.page.content());
      throw e;
    }
    await searchPage.expectResultCount(1);
    await searchPage.expectTitlesContain("Midnight");
  });

  test("partial keyword search matches across title, author, and genre", async ({
    searchPage,
  }) => {
    await searchPage.search("Productivity");

    await searchPage.expectSearchResults("Productivity");
    await searchPage.expectMinResultCount(2);
    await searchPage.expectTitlesContain("Atomic");
    await searchPage.expectTitlesContain("Deep");
  });

  test("case-insensitive search returns the same results", async ({
    searchPage,
  }) => {
    await searchPage.search("paulo coelho");

    await searchPage.expectMinResultCount(1);
    await searchPage.expectTitlesContain("Alchemist");
  });

  test("search by author returns all books by that author", async ({
    searchPage,
  }) => {
    await searchPage.search("Cal Newport");

    await searchPage.expectMinResultCount(1);
    await searchPage.expectTitlesContain("Deep Work");
  });

  test("search by genre returns all books in that genre", async ({
    searchPage,
  }) => {
    await searchPage.search("Programming");

    await searchPage.expectMinResultCount(2);
    await searchPage.expectTitlesContain("Clean Code");
    await searchPage.expectTitlesContain("Pragmatic");
  });

  test("displaying all books when no query is provided", async ({
    searchPage,
  }) => {
    await searchPage.goto();

    await expect(
      searchPage.page.getByRole("heading", { name: "All Books" }),
    ).toBeVisible();
  });

  test("empty state is shown for non-existent search terms", async ({
    searchPage,
  }) => {
    await searchPage.search("zzzzzzzzzzzthisbookdoesnotexist");

    await searchPage.expectNoResults();
  });

  test("search results count matches the number of seeded books for the test prefix", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    // 8 books are seeded in createSeedBooks
    await searchPage.expectResultCount(8);
  });

  test("URL contains the query parameter after search", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(`${searchTestId}-Library`);

    const query = await searchPage.getSearchQueryFromUrl();
    expect(query).toContain("Library");
  });
});
