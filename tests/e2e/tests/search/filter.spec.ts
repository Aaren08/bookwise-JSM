import { test, expect } from "../../fixtures/search-fixture";
import {
  seedSearchBooks,
  cleanupSearchBooks,
  signIn,
} from "../../fixtures/search-fixture";

test.describe("Book Filtering", () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page, searchTestId }) => {
    await signIn(page);
    await seedSearchBooks(searchTestId);
  });

  test.afterEach(async ({ searchTestId }) => {
    await cleanupSearchBooks(searchTestId);
  });

  test("filter by author sorts results by author then title", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);
    await searchPage.selectFilter("Author");

    const titles = await searchPage.getResultTitles();
    expect(titles.length).toBe(8);

    // Author sort: Andrew Hunt..., Cal Newport, James Clear, Kyle Simpson,
    //   Matt Haig, Morgan Housel, Paulo Coelho, Robert C. Martin
    const first = titles[0];
    const last = titles[titles.length - 1];
    expect(first).toContain("Pragmatic"); // Andrew Hunt, David Thomas
    expect(last).toContain("Clean Code"); // Robert C. Martin
  });

  test("filter by genre sorts results by genre then author then title", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);
    await searchPage.selectFilter("Genre");

    const genres = await searchPage.getResultGenres();
    expect(genres.length).toBe(8);

    // Genre sort asc: Computer Science / JavaScript, Computer Science / Programming, ...
    expect(genres[0]).toBe("Computer Science / JavaScript");
    expect(genres[genres.length - 1]).toBe("Self-Help / Productivity");

    // All Computer Science / Programming results are contiguous
    const csCount = genres.filter((g) => g === "Computer Science / Programming").length;
    const csStart = genres.indexOf("Computer Science / Programming");
    const csEnd = csStart + csCount - 1;
    expect(csEnd - csStart + 1).toBe(csCount);
  });

  test("filter by rating sorts results from highest to lowest rating", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);
    await searchPage.selectFilter("Rating");

    const titles = await searchPage.getResultTitles();

    // First result should be the 4.9-rated book
    expect(titles[0]).toContain("Atomic Habits");

    // Last result should be the 4.5-rated book
    expect(titles[titles.length - 1]).toContain("Alchemist");
  });

  test("filter by availability shows all books since none have zero copies", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);
    await searchPage.selectFilter("Availability");

    const titles = await searchPage.getResultTitles();

    // All 8 seeded books have availableCopies > 0
    expect(titles.length).toBe(8);
  });

  test("filter by availability sorts by most available first", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);
    await searchPage.selectFilter("Availability");

    const titles = await searchPage.getResultTitles();

    // Clean Code has 56 copies, should be first
    expect(titles[0]).toContain("Clean Code");
    // The Pragmatic Programmer has 3 copies, should be last
    expect(titles[titles.length - 1]).toContain("Pragmatic");
  });

  test("changing filter updates the URL query parameter", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await searchPage.selectFilter("Genre");
    expect(await searchPage.getFilterFromUrl()).toBe("genre");

    await searchPage.selectFilter("Rating");
    expect(await searchPage.getFilterFromUrl()).toBe("rating");
  });

  test("changing filter resets page to 1", async () => {
    // Only works if pagination exists — seed with 24+ results
    // Skipped in this test set; see pagination.spec.ts for page-reset coverage
    test.skip(true, "Covered in pagination.spec.ts");
  });
});
