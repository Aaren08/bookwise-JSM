import { Page, Locator, expect } from "@playwright/test";

export class HomePage {
  readonly page: Page;
  readonly welcomeHeader: Locator;
  readonly profileAvatar: Locator;

  constructor(page: Page) {
    this.page = page;
    this.welcomeHeader = page.getByRole("heading", {
      level: 1,
      name: /BookWise/i,
    });
    this.profileAvatar = page.getByRole("button", {
      name: "Borrow Book Request",
    });
  }

  async expectToBeLoaded() {
    // Asserts URL changed and main elements are visible
    await expect(this.page).toHaveURL(/.*\/page/);
    await expect(this.welcomeHeader).toBeVisible();
    await expect(this.profileAvatar).toBeVisible();
  }
}
