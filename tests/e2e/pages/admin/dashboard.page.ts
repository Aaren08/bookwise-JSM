import { Page, Locator, expect } from "@playwright/test";

export class AdminDashboardPage {
  readonly page: Page;

  readonly skeletonStatCards: Locator;
  readonly statCards: Locator;
  readonly borrowRequestsSection: Locator;
  readonly accountRequestsSection: Locator;
  readonly recentBooksSection: Locator;
  readonly borrowRequestCards: Locator;
  readonly accountRequestCards: Locator;
  readonly dashboardLayout: Locator;

  constructor(page: Page) {
    this.page = page;

    this.dashboardLayout = page.locator(".w-full.space-y-6");
    this.skeletonStatCards = page.locator(".stat-cards .bg-skeleton").first();
    this.statCards = page.locator(".stat-card_container");
    this.borrowRequestsSection = page.locator(".borrow-requests-container");
    this.accountRequestsSection = page.locator(".account-requests-container");
    this.recentBooksSection = page.locator(".recent-books-container");
    this.borrowRequestCards = page.locator(".borrow-request-card");
    this.accountRequestCards = page.locator(".account-request-card");
  }

  async goto() {
    await this.page.goto("/admin");
  }

  async waitForSkeletonsToDisappear(timeout = 15_000) {
    await expect(this.skeletonStatCards).not.toBeVisible({ timeout });
  }

  async waitForStatsToRender(timeout = 15_000) {
    await expect(this.statCards.first()).toBeVisible({ timeout });
    await expect(this.page.locator(".stat-value").first()).toBeVisible({ timeout });
  }

  async waitForBorrowRequestsToRender(timeout = 15_000) {
    await expect(this.borrowRequestsSection).toBeVisible({ timeout });
  }

  async waitForAccountRequestsToRender(timeout = 15_000) {
    await expect(this.accountRequestsSection).toBeVisible({ timeout });
  }

  async getStatValue(title: string): Promise<number> {
    const card = this.statCards.filter({ hasText: title });
    const valueText = await card.locator(".stat-value").textContent();
    return parseInt(valueText?.trim() ?? "0", 10);
  }

  async expectStatValue(title: string, expected: number, timeout = 15_000) {
    await expect
      .poll(async () => this.getStatValue(title), { timeout })
      .toBe(expected);
  }

  async expectStatChange(title: string, delta: number, timeout = 20_000) {
    const initial = await this.getStatValue(title);
    await expect
      .poll(async () => this.getStatValue(title), { timeout })
      .toBe(initial + delta);
  }

  async getBorrowRequestCount(): Promise<number> {
    return this.borrowRequestCards.count();
  }

  async getAccountRequestCount(): Promise<number> {
    return this.accountRequestCards.count();
  }

  async findBorrowRequestByBookTitle(bookTitle: string): Promise<Locator> {
    return this.page.locator(".borrow-request-card").filter({ hasText: bookTitle }).first();
  }

  async findBorrowRequestByUserName(userName: string): Promise<Locator> {
    return this.page.locator(".borrow-request-card").filter({ hasText: userName }).first();
  }

  async findAccountRequestByEmail(email: string): Promise<Locator> {
    return this.accountRequestCards.filter({ hasText: email }).first();
  }

  async expectBorrowRequestVisible(bookTitle: string, timeout = 20_000) {
    const card = await this.findBorrowRequestByBookTitle(bookTitle);
    await expect(card).toBeVisible({ timeout });
  }

  async expectBorrowRequestNotVisible(bookTitle: string, timeout = 20_000) {
    const card = this.page.locator(".borrow-request-card").filter({ hasText: bookTitle }).first();
    await expect(card).not.toBeVisible({ timeout });
  }

  async expectAccountRequestVisible(email: string, timeout = 20_000) {
    const card = await this.findAccountRequestByEmail(email);
    await expect(card).toBeVisible({ timeout });
  }

  async expectAccountRequestNotVisible(email: string, timeout = 20_000) {
    const card = this.accountRequestCards.filter({ hasText: email }).first();
    await expect(card).not.toBeVisible({ timeout });
  }

  async expectBorrowRequestContainsBookTitle(bookTitle: string) {
    await expect(
      this.page.getByRole("heading", { name: bookTitle, exact: false }).first(),
    ).toBeVisible();
  }

  async expectBorrowRequestContainsUserName(userName: string) {
    await expect(
      this.page.locator(".borrow-request-user-name").filter({ hasText: userName }).first(),
    ).toBeVisible();
  }

  async expectNoConsoleErrors(errors: string[]) {
    const critical = errors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("AbortError") &&
        !e.includes("EventSource"),
    );
    expect(critical, `Console/network errors: ${critical.join("; ")}`).toHaveLength(0);
  }
}
