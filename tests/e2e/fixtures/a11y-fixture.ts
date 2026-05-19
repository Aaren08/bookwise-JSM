import { test as base } from "./base-fixture";
import AxeBuilder from "@axe-core/playwright";
import { Keyboard } from "../utils/keyboard";

type A11yFixtures = {
  makeAxeBuilder: () => AxeBuilder;
  keyboard: Keyboard;
};

export const test = base.extend<A11yFixtures>({
  makeAxeBuilder: [
    async ({ page }, use) => {
      const makeAxeBuilder = () =>
        new AxeBuilder({ page }).withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21a",
          "wcag21aa",
        ]);

      await use(makeAxeBuilder);
    },
    { scope: "test" },
  ],

  keyboard: [
    async ({ page }, use) => {
      await use(new Keyboard(page));
    },
    { scope: "test" },
  ],
});

export { expect } from "@playwright/test";
