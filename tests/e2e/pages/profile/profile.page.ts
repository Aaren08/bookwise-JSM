import { Page, Locator, expect } from "@playwright/test";

export class ProfilePage {
  readonly page: Page;
  readonly avatarTrigger: Locator;
  readonly avatarImage: Locator;
  readonly hiddenFileInput: Locator;
  readonly cropperModal: Locator;
  readonly cropperSaveButton: Locator;
  readonly cropperCancelButton: Locator;
  readonly cropperZoomSlider: Locator;
  readonly headerAvatar: Locator;
  readonly navigationAvatar: Locator;
  readonly profileName: Locator;
  readonly profileEmail: Locator;
  readonly universityCardImage: Locator;
  readonly statusBadge: Locator;
  readonly fullName: Locator;

  constructor(page: Page) {
    this.page = page;
    this.avatarTrigger = page.getByRole("button", { name: /Change avatar/i });
    this.avatarImage = page.getByAltText("user avatar");
    this.hiddenFileInput = page.locator(
      'input[type="file"][accept="image/*"]',
    );
    this.cropperModal = page.locator(".cropper-modal");
    this.cropperSaveButton = page.locator(".cropper-save_btn");
    this.cropperCancelButton = page.locator(".cropper-cancel_btn");
    this.cropperZoomSlider = page
      .locator(".cropper-zoom_input")
      .or(page.locator('input[type="range"][aria-label="Zoom"]'));
    this.profileName = page.locator(".profile-name");
    this.profileEmail = page.locator(".profile-email");
    this.universityCardImage = page.getByAltText("university card");
    this.statusBadge = page.locator(".profile-status_badge");
    this.headerAvatar = page
      .locator("header")
      .getByRole("link", { name: /./ })
      .first();
    this.navigationAvatar = page.locator("nav").getByAltText("user avatar");
    this.fullName = page.locator(".profile-name");
  }

  async goto(): Promise<void> {
    await this.page.goto("/my-profile", { waitUntil: "load" });
  }

  async isProfileLoaded(): Promise<boolean> {
    try {
      await expect(this.profileName).toBeVisible({ timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async openFilePicker(): Promise<void> {
    await this.avatarTrigger.click();
  }

  async selectImageForUpload(filePath: string): Promise<void> {
    await this.hiddenFileInput.setInputFiles(filePath);
    await expect(this.cropperModal).toBeVisible({ timeout: 10_000 });
  }

  async adjustZoom(value: number): Promise<void> {
    await this.cropperZoomSlider.waitFor({ state: "visible", timeout: 5_000 });
    await this.cropperZoomSlider.fill(String(value));
  }

  async saveCroppedImage(): Promise<void> {
    await this.cropperSaveButton.click();
    await this.cropperModal.waitFor({ state: "hidden", timeout: 10_000 });
  }

  async cancelCropping(): Promise<void> {
    await this.cropperCancelButton.click();
    await this.cropperModal.waitFor({ state: "hidden", timeout: 10_000 });
  }

  async verifyAvatarUpdated(expectedPartialSrc?: string): Promise<void> {
    await expect(this.avatarImage).toBeVisible({ timeout: 10_000 });
    const src = await this.avatarImage.getAttribute("src");
    expect(src).not.toBeNull();
    expect(src?.length).toBeGreaterThan(0);
    if (expectedPartialSrc) {
      expect(src).toContain(expectedPartialSrc);
    }
  }

  async verifyHeaderAvatarUpdated(): Promise<void> {
    await expect(this.headerAvatar).toBeVisible({ timeout: 10_000 });
  }

  async verifyUniversityCardVisible(): Promise<void> {
    await expect(this.universityCardImage).toBeVisible({ timeout: 10_000 });
  }

  async verifyStatusBadge(expectedText: string): Promise<void> {
    await expect(this.statusBadge).toContainText(expectedText, {
      timeout: 10_000,
    });
  }

  async waitForUploadToComplete(): Promise<void> {
    await this.page.waitForResponse(
      (response) =>
        response.url().includes("upload.imagekit.io") &&
        response.status() === 200,
      { timeout: 30_000 },
    );
  }

  async waitForAvatarApiComplete(): Promise<void> {
    await this.page.waitForResponse(
      (response) =>
        response.url().includes("/api/avatar") &&
        response.status() === 200 &&
        response.request().method() === "POST",
      { timeout: 15_000 },
    );
  }

  getUniversityCardSrc = async (): Promise<string | null> => {
    return this.universityCardImage.getAttribute("src");
  };

  getAvatarSrc = async (): Promise<string | null> => {
    return this.avatarImage.getAttribute("src");
  };
}
