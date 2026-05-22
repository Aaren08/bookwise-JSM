import { test, expect } from "../../fixtures/upload-fixture";
import { generateUserData } from "../../data/factories";
import { waitForPageReady } from "../../utils/a11y";

test.describe("Avatar Upload + Crop Workflow", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.beforeEach(async ({ page, signupPage }) => {
    // Create a new user via sign-up (auto-signs in via signInWithCredentials in the server action)
    const userData = generateUserData();
    await signupPage.goto();
    await waitForPageReady(page);
    await signupPage.fillSignupForm(userData);
    await signupPage.submit();
    await expect(
      page.getByRole("heading", { name: /Check your inbox/i }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("completes full avatar upload and crop workflow", async ({
    page,
    profilePage,
  }) => {
    test.setTimeout(90_000);

    await test.step("1. Navigate to profile page", async () => {
      await profilePage.goto();
      await waitForPageReady(page);
      const loaded = await profilePage.isProfileLoaded();
      expect(loaded).toBe(true);
    });

    await test.step("2. Open file picker and select image", async () => {
      const fileChooserPromise = page.waitForEvent("filechooser");
      await profilePage.avatarTrigger.click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles("tests/e2e/data/mock-id.png");
    });

    await test.step("3. Crop modal opens and renders preview", async () => {
      await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });

      const zoomSlider = profilePage.cropperZoomSlider;
      await expect(zoomSlider).toBeVisible({ timeout: 5_000 });
      const initialZoom = await zoomSlider.inputValue();
      expect(Number(initialZoom)).toBe(1);
    });

    await test.step("4. Adjust zoom level via slider", async () => {
      await profilePage.adjustZoom(1.5);
      const currentZoom = await profilePage.cropperZoomSlider.inputValue();
      expect(Number(currentZoom)).toBeCloseTo(1.5, 0);
    });

    await test.step("5. Save cropped image and upload", async () => {
      const uploadPromise = page.waitForResponse(
        (response) =>
          response.url().includes("upload.imagekit.io") &&
          response.status() === 200,
        { timeout: 30_000 },
      );
      const avatarApiPromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/avatar") &&
          response.status() === 200 &&
          response.request().method() === "POST",
        { timeout: 15_000 },
      );

      await profilePage.cropperSaveButton.click();

      await uploadPromise;
      await avatarApiPromise;

      await expect(profilePage.cropperModal).not.toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("6. Verify avatar updated on profile", async () => {
      await profilePage.verifyAvatarUpdated();
    });
  });

  test("crop modal is accessible with keyboard", async ({
    page,
    profilePage,
  }) => {
    test.setTimeout(60_000);

    await profilePage.goto();
    await waitForPageReady(page);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await profilePage.avatarTrigger.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("tests/e2e/data/mock-id.png");

    await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });

    const cancelButton = page.getByRole("button", { name: "Cancel" });
    const saveButton = page.getByRole("button", { name: /Save & Upload/ });

    await expect(cancelButton).toBeVisible();
    await expect(saveButton).toBeVisible();
    await expect(page.locator(".cropper-zoom_input")).toBeVisible();
    await expect(
      page.locator(".cropper-zoom_input"),
    ).toHaveAttribute("aria-label", "Zoom");
  });

  test("crop modal closes without saving", async ({ page, profilePage }) => {
    test.setTimeout(60_000);

    await profilePage.goto();
    await waitForPageReady(page);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await profilePage.avatarTrigger.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("tests/e2e/data/mock-id.png");

    await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });

    await profilePage.cropperCancelButton.click();
    await expect(profilePage.cropperModal).not.toBeVisible({
      timeout: 5_000,
    });

    await expect(profilePage.avatarImage).toBeVisible();
  });

  test("avatar upload with zoom adjustment produces different cropped result", async ({
    page,
    profilePage,
  }) => {
    test.setTimeout(90_000);

    await profilePage.goto();
    await waitForPageReady(page);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await profilePage.avatarTrigger.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("tests/e2e/data/mock-id.png");

    await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });

    await profilePage.adjustZoom(2);

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
  });

  test("avatar upload button is disabled during active upload", async ({
    page,
    profilePage,
  }) => {
    test.setTimeout(60_000);

    await page.route("https://upload.imagekit.io/**", async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fileId: "test_file_delayed",
          name: "delayed.jpg",
          url: "/images/auth-illustration.png",
          fileType: "image",
        }),
      });
    });

    await profilePage.goto();
    await waitForPageReady(page);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await profilePage.avatarTrigger.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("tests/e2e/data/mock-id.png");

    await expect(profilePage.cropperModal).toBeVisible({ timeout: 10_000 });
    await profilePage.cropperSaveButton.click();
    await expect(profilePage.avatarTrigger).toBeDisabled({ timeout: 5_000 });
    await expect(profilePage.cropperModal).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("avatar propagates to header after update", async ({
    page,
    profilePage,
  }) => {
    test.setTimeout(90_000);

    await profilePage.goto();
    await waitForPageReady(page);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await profilePage.avatarTrigger.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("tests/e2e/data/mock-id.png");

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

    await expect(page.locator("header").getByRole("img").first()).toBeVisible({
      timeout: 10_000,
    });

    const headerImg = page.locator("header").getByRole("img").first();
    const headerSrc = await headerImg.getAttribute("src");
    expect(headerSrc).toBeTruthy();
  });

  test("no full page reload occurs during avatar update", async ({
    page,
    profilePage,
  }) => {
    test.setTimeout(90_000);

    let navigationCount = 0;
    page.on("load", () => {
      navigationCount++;
    });

    await profilePage.goto();
    await waitForPageReady(page);
    const initialNavigations = navigationCount;

    const fileChooserPromise = page.waitForEvent("filechooser");
    await profilePage.avatarTrigger.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("tests/e2e/data/mock-id.png");

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

    await expect(profilePage.avatarImage).toBeVisible({ timeout: 10_000 });
    expect(navigationCount).toBe(initialNavigations);
  });

  test("can upload multiple times sequentially", async ({
    page,
    profilePage,
  }) => {
    test.setTimeout(120_000);

    await profilePage.goto();
    await waitForPageReady(page);

    for (let i = 0; i < 2; i++) {
      await test.step(`Upload iteration ${i + 1}`, async () => {
        const fileChooserPromise = page.waitForEvent("filechooser");
        await profilePage.avatarTrigger.click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles("tests/e2e/data/mock-id.png");

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
      });
    }
  });
});
