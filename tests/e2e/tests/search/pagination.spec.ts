import { test, expect } from "../../fixtures/search-fixture";
import {
  seedSearchBooks,
  cleanupSearchBooks,
  signIn,
} from "../../fixtures/search-fixture";

const PAGINATION_COUNT = 16; // 8 core + 16 extra = 24 total, 2 pages at 12/book

test.describe("Search Pagination", () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page, searchTestId }) => {
    await signIn(page);
    await seedSearchBooks(searchTestId, {
      includePagination: true,
      paginationCount: PAGINATION_COUNT,
    });
  });

  test.afterEach(async ({ searchTestId }) => {
    await cleanupSearchBooks(searchTestId);
  });

  test("pagination controls appear when results span multiple pages", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await expect(searchPage.paginationContainer).toBeVisible();
  });

  test("clicking page 2 loads the next set of results", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await searchPage.goToPage(2);

    expect(await searchPage.getPageFromUrl()).toBe(2);
    expect(await searchPage.hasResults()).toBe(true);
  });

  test("page 2 has fewer or equal results than page 1 (last partial page)", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    const page1Count = await searchPage.getResultCount();
    expect(page1Count).toBeGreaterThan(0);

    await searchPage.goToPage(2);

    const page2Count = await searchPage.getResultCount();
    expect(page2Count).toBeGreaterThan(0);
    expect(page2Count).toBeLessThanOrEqual(page1Count);
  });

  test("first page and second page show different results", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    const page1Titles = await searchPage.getResultTitles();

    await searchPage.goToPage(2);
    const page2Titles = await searchPage.getResultTitles();

    for (const title of page2Titles) {
      expect(page1Titles).not.toContain(title);
    }
  });

  test("previous button is disabled on page 1", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    // On page 1 the previous button is always a disabled <button>
    const prev = searchPage.page.locator("#pagination > :first-child");
    await expect(prev).toBeDisabled();
  });

  test("next button is disabled on the last page", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);
    await searchPage.goToPage(2);

    // On the last page the next button is always a disabled <button>
    const next = searchPage.page.locator("#pagination > :last-child");
    await expect(next).toBeDisabled();
  });

  test("page number links exist for both page 1 and page 2", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await expect(
      searchPage.page.getByRole("link", { name: "1", exact: true }),
    ).toBeVisible();
    await expect(
      searchPage.page.getByRole("link", { name: "2", exact: true }),
    ).toBeVisible();
  });

  test("URL page parameter syncs with pagination clicks", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await searchPage.goToPage(2);
    expect(await searchPage.getPageFromUrl()).toBe(2);
  });

  test("changing filter resets to page 1", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await searchPage.goToPage(2);
    expect(await searchPage.getPageFromUrl()).toBe(2);

    await searchPage.selectFilter("Rating");
    expect(await searchPage.getPageFromUrl()).toBe(1);
  });
});
