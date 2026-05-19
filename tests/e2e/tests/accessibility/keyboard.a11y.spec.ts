import { test, expect } from "../../fixtures/a11y-fixture";

test.describe("Accessibility - Keyboard Navigation", () => {
  test.beforeEach(async ({ signupPage }) => {
    await signupPage.goto();
  });

  test("Escape key does not break the form", async ({ page, signupPage }) => {
    await signupPage.fullNameInput.focus();
    await page.keyboard.press("Escape");

    await expect(signupPage.fullNameInput).toBeFocused();
  });

  test("validation errors are focus-managed after invalid submission", async ({
    page,
    signupPage,
  }) => {
    await signupPage.submit();
    await page.waitForTimeout(500);

    const activeTag = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "none";
      return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}`;
    });

    expect(activeTag).not.toBe("body");
    expect(activeTag).not.toBe("none");
  });
});
