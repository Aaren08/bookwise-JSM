import { Page, Locator, expect } from "@playwright/test";

/**
 * Page Object Model for the SSR-driven /search route.
 *
 * Navigation waits use `expect.toPass()` polling instead of `waitForURL()`
 * because:
 *   1. Next.js dev-mode WebSocket prevents `waitForLoadState("networkidle")`.
 *   2. Next.js `router.replace` (used by the filter dropdown) updates the URL
 *      via History API without always triggering Playwright's `framenavigated`
 *      event, making `waitForURL` unreliable.
 *   3. `expect.toPass()` polls the assertion every 500ms, catching the URL
 *      regardless of how it changed.
 */
export class SearchPage {
  readonly page: Page;

  // ---- Form ----
  readonly searchInput: Locator;

  // ---- Filter dropdown (shadcn Select) ----
  readonly filterTrigger: Locator;

  // ---- Results ----
  readonly resultsHeading: Locator;
  readonly resultCards: Locator;
  readonly resultTitles: Locator;
  readonly resultGenres: Locator;
  readonly resultsHeaderMessage: Locator;
  readonly noResultsHeading: Locator;
  readonly clearSearchButton: Locator;

  // ---- Pagination ----
  readonly paginationContainer: Locator;

  constructor(page: Page) {
    this.page = page;

    this.searchInput = page.getByPlaceholder(
      "Search for books, authors, genres...",
    );

    // shadcn SelectTrigger renders as a <button role="combobox"> whose
    // accessible name is the full visible text ("Filter by: Author").
    // Using a CSS class selector is more reliable than matching the aria name,
    // which varies as the selected value changes.
    this.filterTrigger = page.locator(".select-trigger");

    this.resultsHeading = page.getByRole("heading", { name: "Search Results" });
    this.resultsHeaderMessage = page
      .locator("p")
      .filter({ hasText: /Search results for/ });
    this.resultCards = page.locator(".book-list > li");
    this.resultTitles = page.locator(".book-title");
    this.resultGenres = page.locator(".book-genre");

    this.noResultsHeading = page.getByRole("heading", {
      name: "No Results Found",
    });
    this.clearSearchButton = page.getByRole("link", { name: "Clear Search" });

    this.paginationContainer = page.locator("#pagination");
  }

  // =======================================================================
  //  Navigation
  // =======================================================================

  async goto(params?: { query?: string; filter?: string; page?: number }) {
    const qs = new URLSearchParams();
    if (params?.query) qs.set("query", params.query);
    if (params?.filter) qs.set("filter", params.filter);
    if (params?.page && params.page > 1) qs.set("page", String(params.page));
    await this.page.goto(`/search${qs.toString() ? "?" + qs.toString() : ""}`);
  }

  /** Navigate directly via URL — avoids browser form-submit variability. */
  async search(query: string) {
    await this.page.goto(`/search?query=${encodeURIComponent(query)}`);
  }

  /**
   * Change filter via the shadcn Select dropdown.
   *
   * Why this is non-trivial:
   *  - `SearchFilter` lives inside a `<Suspense>` boundary — it only mounts
   *    after the SSR stream delivers `BookResults`.  We must wait for the
   *    trigger to be visible *and* enabled before clicking.
   *  - Radix UI (used by shadcn Select) fires `onValueChange` on pointer-up
   *    inside the item element.  `getByRole("option")` resolves to the Radix
   *    item correctly, but we target it by its CSS class `.select-item` and
   *    text to avoid any ARIA-tree resolution timing issues.
   *  - `router.replace` is wrapped in `startTransition`, so the URL update
   *    is deferred.  We use `waitForURL` (regex match) as the authoritative
   *    signal rather than polling `searchParams` manually.
   *  - After URL commit we wait for the Suspense loader to disappear so the
   *    new results are fully painted before the caller proceeds.
   */
  async selectFilter(filterLabel: string) {
    const expected = filterLabel.toLowerCase();

    // 1. Wait for the trigger to be visible and enabled (Suspense must have resolved).
    await this.filterTrigger.waitFor({ state: "visible", timeout: 15_000 });
    await expect(this.filterTrigger).toBeEnabled({ timeout: 15_000 });

    // 2. Open the dropdown.
    await this.filterTrigger.click();

    // 3. Target the item by its CSS class + text content.
    const option = this.page
      .locator(".select-item")
      .filter({ hasText: new RegExp(`^${filterLabel}$`, "i") });
    await option.waitFor({ state: "visible", timeout: 10_000 });
    await option.click();

    // 4. Wait for the URL to update. router.replace uses the History API —
    //    no network navigation fires, so `waitUntil: "commit"` times out.
    //    We use `expect.toPass` polling instead of `waitForURL`.
    await expect(() => {
      const currentFilter = new URL(this.page.url()).searchParams.get("filter") || "author";
      expect(currentFilter).toBe(expected);
    }).toPass({ timeout: 15_000, intervals: [500] });

    // 5. Wait for the Suspense loader to clear so new SSR results are rendered.
    await this.page
      .locator(".loader")
      .waitFor({ state: "detached", timeout: 15_000 })
      .catch(() => {
        // Loader may not appear when Next.js serves from cache — that is fine.
      });
  }

  /** Click a pagination page-number link, then wait for the page param. */
  async goToPage(pageNumber: number) {
    await this.page
      .getByRole("link", { name: String(pageNumber), exact: true })
      .click();
    await expect(() => {
      const current = parseInt(
        new URL(this.page.url()).searchParams.get("page") || "1",
        10,
      );
      expect(current).toBe(pageNumber);
    }).toPass({ timeout: 10_000, intervals: [500] });

    // Wait for the new page's results (or no-results state) to render before
    // the caller makes assertions, so the book-list reflects the new page.
    await this.page.waitForLoadState("domcontentloaded");
    await this.page
      .locator(".book-list, #not-found, [data-testid='no-results']")
      .first()
      .waitFor({ state: "attached", timeout: 10_000 })
      .catch(() => {
        // If neither selector appears the page may still render results via
        // an alternate selector — let the caller's assertions handle it.
      });
  }

  /** Click the "Clear Search" link on the no-results page. */
  async clearSearch() {
    await this.clearSearchButton.click();
    await expect(() => {
      const q = new URL(this.page.url()).searchParams.get("query");
      expect(q).toBeFalsy();
    }).toPass({ timeout: 10_000, intervals: [500] });
  }

  // =======================================================================
  //  Queries
  // =======================================================================

  async getResultTitles(): Promise<string[]> {
    await this.resultTitles
      .first()
      .waitFor({ state: "attached", timeout: 10_000 });
    return this.resultTitles.allTextContents();
  }

  async getResultGenres(): Promise<string[]> {
    await this.resultGenres
      .first()
      .waitFor({ state: "attached", timeout: 10_000 });
    return this.resultGenres.allTextContents();
  }

  async getResultCount(): Promise<number> {
    return this.resultCards.count();
  }

  async hasResults(): Promise<boolean> {
    return (await this.resultCards.count()) > 0;
  }

  async getSearchQueryFromUrl(): Promise<string> {
    return new URL(this.page.url()).searchParams.get("query") || "";
  }

  async getFilterFromUrl(): Promise<string> {
    return new URL(this.page.url()).searchParams.get("filter") || "author";
  }

  async getPageFromUrl(): Promise<number> {
    return parseInt(
      new URL(this.page.url()).searchParams.get("page") || "1",
      10,
    );
  }

  // =======================================================================
  //  Assertions
  // =======================================================================

  async expectSearchResults(query: string) {
    await expect(this.resultsHeading).toBeVisible();
    await expect(this.resultsHeaderMessage).toContainText(query);
  }

  async expectNoResults() {
    await expect(this.noResultsHeading).toBeVisible();
  }

  async expectResultCount(expected: number) {
    await expect(this.resultCards).toHaveCount(expected);
  }

  async expectMinResultCount(expected: number) {
    await expect(this.resultCards).not.toHaveCount(0);
    const count = await this.resultCards.count();
    expect(count).toBeGreaterThanOrEqual(expected);
  }

  async expectTitlesContain(substring: string) {
    const titles = await this.getResultTitles();
    expect(
      titles.some((t) => t.toLowerCase().includes(substring.toLowerCase())),
    ).toBe(true);
  }
}
