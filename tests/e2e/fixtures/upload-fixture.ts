import { test as base } from "@playwright/test";
import { SignupPage } from "../pages/auth/signup.page";
import { SigninPage } from "../pages/auth/signin.page";
import { ProfilePage } from "../pages/profile/profile.page";
import { CropperHelper } from "../helpers/cropper-helpers";
import { NetworkInterceptor } from "../helpers/network-helpers";
import {
  MOCK_IMAGEKIT_AUTH,
  MOCK_IMAGEKIT_UPLOAD_RESPONSE,
} from "../helpers/upload-helpers";

type UploadFixtures = {
  signupPage: SignupPage;
  signinPage: SigninPage;
  profilePage: ProfilePage;
  cropper: CropperHelper;
  networkInterceptor: NetworkInterceptor;
};

export const test = base.extend<UploadFixtures>({
  signupPage: async ({ page }, use) => {
    await page.route("**/api/auth/imagekit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_IMAGEKIT_AUTH),
      });
    });
    await page.route("https://upload.imagekit.io/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_IMAGEKIT_UPLOAD_RESPONSE),
      });
    });
    await page.route("**/api/auth/session", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ user: { image: "/images/auth-illustration.png" } }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route("**/api/auth/csrf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ csrfToken: "mock-csrf-token" }),
      });
    });
    await use(new SignupPage(page));
  },

  signinPage: async ({ page }, use) => {
    await use(new SigninPage(page));
  },

  profilePage: async ({ page }, use) => {
    await page.route("**/api/auth/imagekit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_IMAGEKIT_AUTH),
      });
    });
    await page.route("https://upload.imagekit.io/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_IMAGEKIT_UPLOAD_RESPONSE),
      });
    });
    await page.route("**/api/auth/session", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ user: { image: "/images/auth-illustration.png" } }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route("**/api/auth/csrf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ csrfToken: "mock-csrf-token" }),
      });
    });
    await page.route("**/api/avatar", async (route) => {
      if (route.request().method() === "POST") {
        const postData = route.request().postData();
        const body = postData ? JSON.parse(postData) : {};
        if (!body.imageUrl || !body.fileId) {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Image URL and File ID are required",
            }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      } else if (route.request().method() === "PUT") {
        const postData = route.request().postData();
        const body = postData ? JSON.parse(postData) : {};
        if (!body.image) {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "Image is required" }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.continue();
      }
    });
    await use(new ProfilePage(page));
  },

  cropper: async ({ page }, use) => {
    await use(new CropperHelper(page));
  },

  networkInterceptor: async ({ page }, use) => {
    const interceptor = new NetworkInterceptor(page);
    await interceptor.install();
    await use(interceptor);
    await interceptor.dispose();
  },
});

export { expect } from "@playwright/test";
