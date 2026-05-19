import { test as base } from "@playwright/test";
import { SignupPage } from "../pages/auth/signup.page";
import { HomePage } from "../pages/home.page";

// Define the types for our custom fixtures
type MyFixtures = {
  signupPage: SignupPage;
  homePage: HomePage;
};

// Extend base test
export const test = base.extend<MyFixtures>({
  signupPage: async ({ page }, use) => {
    // Intercept local ImageKit token/signature retrieval to keep tests independent of local environment variables.
    await page.route("**/api/auth/imagekit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          signature: "mock_signature",
          expire: Math.floor(Date.now() / 1000) + 3600,
          token: "mock_token",
          publicKey: "mock_public_key",
        }),
      });
    });

    // Intercept ImageKit upload calls to keep tests independent of third-party networks, fast, and parallel-safe.
    await page.route("https://upload.imagekit.io/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "/images/auth-illustration.png",
        }),
      });
    });

    await use(new SignupPage(page));
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
});

export { expect } from "@playwright/test";
