import { Page, Locator, expect } from "@playwright/test";

export class Keyboard {
  constructor(private page: Page) {}

  async tab(times = 1) {
    for (let i = 0; i < times; i++) {
      await this.page.keyboard.press("Tab");
    }
  }

  async shiftTab(times = 1) {
    for (let i = 0; i < times; i++) {
      await this.page.keyboard.press("Shift+Tab");
    }
  }

  async pressEnter() {
    await this.page.keyboard.press("Enter");
  }

  async pressEscape() {
    await this.page.keyboard.press("Escape");
  }

  async pressSpace() {
    await this.page.keyboard.press("Space");
  }

  async expectFocusToBe(element: Locator) {
    await expect(element).toBeFocused();
  }

  async tabAndExpectFocus(element: Locator) {
    await this.page.keyboard.press("Tab");
    await expect(element).toBeFocused();
  }

  async verifyTabOrder(targets: Locator[]) {
    for (const target of targets) {
      await this.page.keyboard.press("Tab");
      await expect(target).toBeFocused();
    }
  }

  async expectFocusTrap(container: Locator) {
    const focusable = container.locator(
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const count = await focusable.count();

    for (let cycle = 0; cycle < 2; cycle++) {
      for (let i = 0; i < count; i++) {
        await this.page.keyboard.press("Tab");
        const focused = this.page.locator(":focus");
        await expect(focused).toBeVisible();
      }
    }
  }

  async getFocusedDescription(): Promise<string> {
    return this.page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "no focus";
      const tag = el.tagName.toLowerCase();
      const label = (el as HTMLElement).getAttribute("aria-label") || "";
      const text = (el as HTMLElement).textContent?.trim().slice(0, 40) || "";
      return `${tag}${label ? `[aria-label="${label}"]` : ""} "${text}"`;
    });
  }
}
