import { test as base, Page, BrowserContext } from "@playwright/test";
import { SigninPage } from "../pages/auth/signin.page";
import { SignupPage } from "../pages/auth/signup.page";
import { HomePage } from "../pages/home.page";
import { SearchPage } from "../pages/search/search.page";
import {
  createConsoleMonitor,
  ConsoleMonitor,
} from "../utils/resilience/console-monitor";
import {
  FailureSimulator,
  createFailureSimulator,
} from "../utils/resilience/failure-simulation";
import {
  NetworkInterceptor,
  createNetworkInterceptor,
} from "../utils/resilience/network-interception";
import { createSseInterceptorScript } from "../utils/sse";

type ResilienceFixtures = {
  signinPage: SigninPage;
  signupPage: SignupPage;
  homePage: HomePage;
  searchPage: SearchPage;
  consoleMonitor: ConsoleMonitor;
  failureSimulator: FailureSimulator;
  networkInterceptor: NetworkInterceptor;
  adminContext: BrowserContext;
  adminPage: Page;
};

export const test = base.extend<ResilienceFixtures>({
  signinPage: async ({ page }, use) => {
    await use(new SigninPage(page));
  },
  signupPage: async ({ page }, use) => {
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
  searchPage: async ({ page }, use) => {
    await use(new SearchPage(page));
  },
  consoleMonitor: async ({ page }, use) => {
    const monitor = createConsoleMonitor(page);
    await use(monitor);
  },
  failureSimulator: async ({ page }, use) => {
    const simulator = createFailureSimulator(page);
    await use(simulator);
  },
  networkInterceptor: async ({ page }, use) => {
    const interceptor = createNetworkInterceptor(page);
    await use(interceptor);
  },
  adminContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  adminPage: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await page.addInitScript(createSseInterceptorScript());
    await use(page);
  },
});

export { expect } from "@playwright/test";
