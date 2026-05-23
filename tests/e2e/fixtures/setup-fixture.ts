import { test as base } from "@playwright/test";
import { AccountPage } from "../pages/system/account.page";
import { SetupPage } from "../pages/system/setup.page";
import { AdminDashboardPage } from "../pages/admin/dashboard.page";

type SetupFixtures = {
  accountPage: AccountPage;
  setupPage: SetupPage;
  dashboardPage: AdminDashboardPage;
};

export const test = base.extend<SetupFixtures>({
  accountPage: async ({ page }, use) => {
    await page.route("**/api/auth/imagekit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          signature: "mock_setup_signature",
          expire: Math.floor(Date.now() / 1000) + 3600,
          token: "mock_setup_token",
          publicKey: "mock_setup_public_key",
        }),
      });
    });

    await page.route("https://upload.imagekit.io/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://ik.imagekit.io/tests/e2e/data/avatar-id.png",
          fileId: "mock_file_id_setup",
        }),
      });
    });

    // Prevent 404 when Next.js image optimization fetches the fake avatar URL
    const PLACEHOLDER_1x1_PNG =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    await page.route("**/_next/image*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(PLACEHOLDER_1x1_PNG, "base64"),
      });
    });

    await use(new AccountPage(page));
  },

  setupPage: async ({ page }, use) => {
    await use(new SetupPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new AdminDashboardPage(page));
  },
});

export { expect } from "@playwright/test";
