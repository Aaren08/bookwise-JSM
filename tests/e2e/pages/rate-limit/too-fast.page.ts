import { Page, expect, TestInfo } from "@playwright/test";
import { checkA11y } from "../../utils/a11y";

export class TooFastPage {
  constructor(private page: Page) {}

  async waitForPageReady() {
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
    await this.page.waitForLoadState("networkidle");
  }

  get heading() {
    return this.page.getByRole("heading", { name: /too fast/i });
  }

  get message() {
    return this.page.getByText(/too many requests|try again later/i);
  }

  get mainContainer() {
    return this.page.locator("main.root-container");
  }

  async validateLayout() {
    await expect(this.heading).toBeVisible();
    await expect(this.message).toBeVisible();
    await expect(this.mainContainer).toBeVisible();

    const headingText = await this.heading.textContent();
    expect(headingText?.toLowerCase()).toContain("too fast");
  }

  async validateStyling() {
    await expect(this.mainContainer).toBeVisible();
    await expect(this.heading).toHaveCSS("font-family", /bebasNeue/i);
  }

  async validateAccessibility(testInfo?: TestInfo) {
    await checkA11y(this.page, { testInfo });
  }

  async validateFocusManagement() {
    const focusedTag = await this.page.evaluate(
      () => document.activeElement?.tagName ?? "",
    );
    expect(["BODY", "MAIN", "H1"]).toContain(focusedTag);
  }
}
