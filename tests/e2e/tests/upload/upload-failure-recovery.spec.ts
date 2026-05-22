import { test, expect } from "../../fixtures/upload-fixture";
import { generateUserData } from "../../data/factories";
import { waitForPageReady } from "../../utils/a11y";
import { SignupPage } from "../../pages/auth/signup.page";
import { ProfilePage } from "../../pages/profile/profile.page";
import {
  MOCK_IMAGEKIT_AUTH,
  MOCK_IMAGEKIT_UPLOAD_RESPONSE,
} from "../../helpers/upload-helpers";

test.describe("Upload Failure Recovery", () => {
  test.describe("University Card Upload Failures", () => {
    function formError(page: import("@playwright/test").Page, message?: string) {
      return page.locator("main").getByText(message ?? "Upload failed");
    }

    test("handles ImageKit auth endpoint failure gracefully", async ({
      page,
      signupPage,
    }) => {
      test.setTimeout(60_000);

      await page.route("**/api/auth/imagekit", (route) => {
        route.fulfill({ status: 500, body: "Internal Server Error" });
      });

      await signupPage.goto();
      await waitForPageReady(page);

      const userData = generateUserData();
      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);

      await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

      await expect(formError(page)).toBeVisible({ timeout: 15_000 });
    });

    test("handles ImageKit upload rejection (400) gracefully", async ({
      page,
      signupPage,
    }) => {
      test.setTimeout(60_000);

      await page.route("https://upload.imagekit.io/**", (route) => {
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Invalid file or request",
            message: "The file type or content is not supported",
          }),
        });
      });

      await signupPage.goto();
      await waitForPageReady(page);

      const userData = generateUserData();
      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);

      await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

      await expect(formError(page, "Invalid file or request")).toBeVisible({ timeout: 15_000 });
    });

    test("handles network interruption during upload gracefully", async ({
      page,
      signupPage,
    }) => {
      test.setTimeout(60_000);

      await page.route("https://upload.imagekit.io/**", (route) => {
        route.abort("connectionrefused");
      });

      await signupPage.goto();
      await waitForPageReady(page);

      const userData = generateUserData();
      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);

      await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

      await expect(formError(page, "Network error occurred")).toBeVisible({ timeout: 15_000 });
    });

    test("allows retry after upload failure", async ({
      page,
      signupPage,
    }) => {
      test.setTimeout(90_000);

      let uploadAttempts = 0;
      await page.route("https://upload.imagekit.io/**", (route) => {
        uploadAttempts++;
        if (uploadAttempts === 1) {
          route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Server error" }),
          });
        } else {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              fileId: "retry_success_file_id",
              name: "retry-success.jpg",
              url: "/images/auth-illustration.png",
              fileType: "image",
            }),
          });
        }
      });

      await signupPage.goto();
      await waitForPageReady(page);

      const userData = generateUserData();
      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);

      await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

      await expect(formError(page, "Server error occurred")).toBeVisible({ timeout: 15_000 });

      const fileInput = signupPage.universityCardUpload;
      await fileInput.setInputFiles(userData.idCardPath);

      await expect(page.getByAltText("Uploaded file")).toBeVisible({
        timeout: 15_000,
      });
      expect(uploadAttempts).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe("Avatar Upload Failures", () => {
    test.describe.configure({ mode: "serial" });
    async function signInAndGoToProfile(page: import("@playwright/test").Page) {
      const userData = generateUserData();

      // Set up success routes for sign-up.
      // Test-specific routes registered later will shadow these (LIFO order)
      // for matching URLs, while these routes remain active for URLs the test
      // does not override (e.g. ImageKit auth during avatar upload).
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

      // Sign up a user (auto-signs in via signInWithCredentials in the server action)
      const signupPage = new SignupPage(page);
      await signupPage.goto();
      await waitForPageReady(page);
      await signupPage.fillSignupForm(userData);
      await signupPage.submit();
      await expect(
        page.getByRole("heading", { name: /Check your inbox/i }),
      ).toBeVisible({ timeout: 20_000 });

      // Navigate to profile page
      const profilePage = new ProfilePage(page);
      await profilePage.goto();
      await waitForPageReady(page);
      return profilePage;
    }

    function avatarTrigger(page: import("@playwright/test").Page) {
      return page.getByRole("button", { name: /Change avatar/i });
    }

    test("handles avatar upload ImageKit auth failure", async ({
      page,
    }) => {
      test.setTimeout(60_000);

      const profilePage = await signInAndGoToProfile(page);

      // Register failure route AFTER sign-in so it shadows signInAndGoToProfile's success route (LIFO)
      await page.route("**/api/auth/imagekit", (route) => {
        route.fulfill({ status: 500, body: "Auth Failed" });
      });

      const fileChooserPromise = page.waitForEvent("filechooser");
      await avatarTrigger(page).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles("tests/e2e/data/mock-id.png");

      await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });

      await profilePage.cropperSaveButton.click();

      await expect(
        page.locator("[data-title]").getByText("Authentication request failed"),
      ).toBeVisible({ timeout: 15_000 });
    });

    test("handles avatar API failure after ImageKit upload", async ({
      page,
    }) => {
      test.setTimeout(60_000);

      await page.route("**/api/avatar", async (route) => {
        if (route.request().method() === "POST") {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Failed to update profile image",
            }),
          });
        } else {
          await route.continue();
        }
      });

      const profilePage = await signInAndGoToProfile(page);

      const fileChooserPromise = page.waitForEvent("filechooser");
      await avatarTrigger(page).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles("tests/e2e/data/mock-id.png");

      await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });

      await profilePage.cropperSaveButton.click();

      await expect(
        page.locator("[data-title]").getByText(/Failed to update/i),
      ).toBeVisible({ timeout: 15_000 });
    });

    test("recovers gracefully after avatar save failure", async ({
      page,
    }) => {
      test.setTimeout(90_000);

      let avatarApiCalled = false;
      await page.route("**/api/avatar", async (route) => {
        if (route.request().method() === "POST") {
          avatarApiCalled = true;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Temporary server error" }),
          });
        } else {
          await route.continue();
        }
      });

      const profilePage = await signInAndGoToProfile(page);

      const fileChooserPromise = page.waitForEvent("filechooser");
      await avatarTrigger(page).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles("tests/e2e/data/mock-id.png");

      await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });
      await profilePage.cropperSaveButton.click();

      await expect(
        page.locator("[data-title]").getByText("Temporary server error"),
      ).toBeVisible({ timeout: 15_000 });

      await page.unroute("**/api/avatar");
      await page.route("**/api/avatar", async (route) => {
        if (route.request().method() === "POST") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: true }),
          });
        } else {
          await route.continue();
        }
      });

      const retryFileChooserPromise = page.waitForEvent("filechooser");
      await avatarTrigger(page).click();
      const retryFileChooser = await retryFileChooserPromise;
      await retryFileChooser.setFiles("tests/e2e/data/mock-id.png");

      await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });

      const uploadPromise = page.waitForResponse(
        (response) =>
          response.url().includes("upload.imagekit.io") &&
          response.status() === 200,
      );
      const avatarApiPromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/avatar") &&
          response.status() === 200 &&
          response.request().method() === "POST",
      );

      await profilePage.cropperSaveButton.click();
      await uploadPromise;
      await avatarApiPromise;

      await profilePage.verifyAvatarUpdated();
      expect(avatarApiCalled).toBe(true);
    });

    test("console does not contain unhandled upload errors", async ({
      page,
    }) => {
      test.setTimeout(60_000);

      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      await page.route("https://upload.imagekit.io/**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            fileId: "diagnostic_file_id",
            name: "diagnostic.jpg",
            url: "/images/auth-illustration.png",
            fileType: "image",
          }),
        });
      });

      const profilePage = await signInAndGoToProfile(page);

      const fileChooserPromise = page.waitForEvent("filechooser");
      await avatarTrigger(page).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles("tests/e2e/data/mock-id.png");

      await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });
      await profilePage.cropperSaveButton.click();

      await profilePage.verifyAvatarUpdated();

      const uploadErrors = consoleErrors.filter(
        (e) =>
          !e.includes("Authentication") &&
          !e.includes("favicon") &&
          !e.includes("next-auth") &&
          !e.includes("chrome-extension"),
      );
      expect(uploadErrors.length).toBe(0);
    });
  });
});
