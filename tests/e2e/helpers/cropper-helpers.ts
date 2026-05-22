import { Page, Locator, expect } from "@playwright/test";

export class CropperHelper {
  constructor(private page: Page) {}

  get modal(): Locator {
    return this.page.locator(".cropper-modal");
  }

  get content(): Locator {
    return this.page.locator(".cropper-content");
  }

  get imageContainer(): Locator {
    return this.page.locator(".cropper-image_container");
  }

  get zoomSlider(): Locator {
    return this.page.locator('input[type="range"][aria-label="Zoom"]');
  }

  get cancelButton(): Locator {
    return this.page.getByRole("button", { name: "Cancel", exact: true });
  }

  get saveButton(): Locator {
    return this.page.getByRole("button", { name: /Save & Upload|Upload/ });
  }

  get avatarTrigger(): Locator {
    return this.page.getByRole("button", { name: /Change avatar/i });
  }

  get hiddenFileInput(): Locator {
    return this.page.locator('input[type="file"][accept="image/*"]').first();
  }

  get profileAvatarImage(): Locator {
    return this.page.getByAltText("user avatar");
  }

  async waitForCropperOpen(): Promise<void> {
    await this.modal.waitFor({ state: "visible", timeout: 10_000 });
    await this.imageContainer.waitFor({ state: "visible", timeout: 5_000 });
  }

  async waitForCropperClosed(): Promise<void> {
    await this.modal.waitFor({ state: "hidden", timeout: 10_000 });
  }

  async uploadImage(filePath: string): Promise<void> {
    await this.avatarTrigger.click();
    await this.hiddenFileInput.setInputFiles(filePath);
    await this.waitForCropperOpen();
  }

  async setZoom(value: number): Promise<void> {
    const slider = this.zoomSlider;
    await slider.waitFor({ state: "visible", timeout: 5_000 });
    await slider.fill(String(value));
    await expect(slider).toHaveValue(String(value));
  }

  async saveCroppedImage(): Promise<void> {
    await this.saveButton.click();
    await this.waitForCropperClosed();
  }

  async cancelCropping(): Promise<void> {
    await this.cancelButton.click();
    await this.waitForCropperClosed();
  }

  async dragToAdjustCrop(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): Promise<void> {
    const cropperElement = this.imageContainer.locator(".react-easy-crop").first();
    await cropperElement.waitFor({ state: "visible", timeout: 5_000 });
    const box = await cropperElement.boundingBox();
    if (!box) throw new Error("Could not get cropper bounding box");
    const sx = box.x + startX;
    const sy = box.y + startY;
    const ex = box.x + endX;
    const ey = box.y + endY;
    await this.page.mouse.move(sx, sy);
    await this.page.mouse.down();
    await this.page.mouse.move(ex, ey, { steps: 10 });
    await this.page.mouse.up();
  }

  async verifyCropperAccessible(): Promise<void> {
    await expect(this.modal).toHaveAttribute("role", "dialog");
    await expect(this.cancelButton).toBeVisible();
    await expect(this.saveButton).toBeVisible();
    const slider = this.zoomSlider;
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute("min", "1");
    await expect(slider).toHaveAttribute("max", "3");
    await expect(slider).toHaveAttribute("aria-label", "Zoom");
  }

  async verifyAvatarUpdated(): Promise<void> {
    await expect(this.profileAvatarImage).toBeVisible({ timeout: 10_000 });
    const src = await this.profileAvatarImage.getAttribute("src");
    expect(src).not.toBeNull();
    expect(src).not.toBe("");
  }
}
