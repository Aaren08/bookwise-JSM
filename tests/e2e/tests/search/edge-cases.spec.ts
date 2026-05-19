import { test, expect } from "../../fixtures/search-fixture";
import {
  seedSearchBooks,
  cleanupSearchBooks,
  signIn,
} from "../../fixtures/search-fixture";

test.describe("Search Edge Cases", () => {
  // Raised from 60 s → 120 s so that the first test in the worker survives
  // Next.js Fast Refresh compilation time (~50 s in dev mode) plus sign-in
  // plus the actual test assertion window.
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, searchTestId }) => {
    await signIn(page);
    await seedSearchBooks(searchTestId);
  });

  test.afterEach(async ({ searchTestId }) => {
    await cleanupSearchBooks(searchTestId);
  });

  test("empty search query shows All Books view", async ({ searchPage }) => {
    await searchPage.goto();
    await expect(
      searchPage.page.getByRole("heading", { name: "All Books" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("special characters in search gracefully show no results", async ({
    searchPage,
  }) => {
    await searchPage.page.goto("/search?query=%21%40%23%24%25%5E%26*()_%2B", {
      waitUntil: "domcontentloaded",
    });
    await expect(searchPage.page.locator("body")).toBeVisible();
    // Should show either no results or some results — either is acceptable
    // as long as the page does not crash.
    const hasNoResults = await searchPage.noResultsHeading
      .isVisible()
      .catch(() => false);
    const hasResults = await searchPage.page
      .locator(".book-list > li")
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasNoResults || hasResults).toBe(true);
  });

  test("XSS attempt in search query does not crash the page", async ({
    searchPage,
  }) => {
    const response = await searchPage.page.goto(
      "/search?query=%3Cscript%3Ealert('xss')%3C%2Fscript%3E",
      { waitUntil: "domcontentloaded" },
    );
    expect(response?.ok()).toBe(true);
    await expect(searchPage.page.locator("body")).toBeVisible();
  });

  test("browser back button navigates to previous search state", async ({
    searchPage,
  }) => {
    await searchPage.search("Clear");
    expect(await searchPage.getSearchQueryFromUrl()).toContain("Clear");

    await searchPage.search("Newport");
    expect(await searchPage.getSearchQueryFromUrl()).toContain("Newport");

    await searchPage.page.goBack();
    await expect(async () => {
      const q = await searchPage.getSearchQueryFromUrl();
      expect(q).toContain("Clear");
    }).toPass({ timeout: 10_000 });
  });

  test("browser forward button restores the later search", async ({
    searchPage,
  }) => {
    await searchPage.search("Clear");
    await searchPage.search("Newport");

    await searchPage.page.goBack();
    // Next.js handles forward navigation client-side via its router — no full
    // load event fires. waitUntil:"commit" resolves as soon as the URL changes.
    await searchPage.page.goForward({ waitUntil: "commit" });

    await expect(async () => {
      const q = await searchPage.getSearchQueryFromUrl();
      expect(q).toContain("Newport");
    }).toPass({ timeout: 10_000 });
  });

  test("refreshing the page preserves active search parameters", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);
    await searchPage.selectFilter("Rating");

    await searchPage.page.reload({ waitUntil: "domcontentloaded" });

    await expect(async () => {
      expect(await searchPage.getFilterFromUrl()).toBe("rating");
      expect(await searchPage.getSearchQueryFromUrl()).toContain(searchTestId);
    }).toPass({ timeout: 10_000 });
  });

  test("rapid filter switching does not break the page", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await searchPage.selectFilter("Genre");
    await searchPage.selectFilter("Rating");
    await searchPage.selectFilter("Author");
    await searchPage.selectFilter("Availability");

    // Poll for results in case there is a brief rendering delay after the
    // final filter transition.
    await expect(async () => {
      expect(await searchPage.hasResults()).toBe(true);
    }).toPass({ timeout: 10_000, intervals: [500] });

    expect(await searchPage.getFilterFromUrl()).toBe("availability");
  });

  test("long search string is handled gracefully", async ({ searchPage }) => {
    const longQuery = "a".repeat(500);
    const response = await searchPage.page.goto(
      `/search?query=${encodeURIComponent(longQuery)}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(response?.ok()).toBe(true);
    await expect(searchPage.page.locator("body")).toBeVisible();
  });

  test("navigating away and back clears search params", async ({
    searchPage,
    searchTestId,
  }) => {
    await searchPage.search(searchTestId);

    await searchPage.page.goto("/");
    await searchPage.page.goto("/search");

    expect(await searchPage.getSearchQueryFromUrl()).toBe("");
  });
});
