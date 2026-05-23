import { Page, Locator, expect } from "@playwright/test";

export class AccountPage {
  readonly page: Page;

  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly createAccountButton: Locator;
  readonly avatarTrigger: Locator;
  readonly fileInput: Locator;
  readonly cropperModal: Locator;
  readonly cropperSaveButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.firstNameInput = page.getByPlaceholder("First name");
    this.lastNameInput = page.getByPlaceholder("Last name");
    this.emailInput = page.getByPlaceholder("Email");
    this.passwordInput = page.getByPlaceholder("Enter your password");
    this.createAccountButton = page.getByRole("button", {
      name: "Create Account",
    });
    this.avatarTrigger = page.getByRole("button", {
      name: "Upload admin avatar",
    });
    this.fileInput = page.locator('input[type="file"][accept="image/*"]');
    this.cropperModal = page.locator(".cropper-modal");
    this.cropperSaveButton = page.locator(".cropper-save_btn");
  }

  async goto() {
    await this.page.goto("/account");
    await this.page.waitForLoadState("networkidle");
    await expect(this.firstNameInput).toBeVisible({ timeout: 10_000 });
  }

  async fillFirstName(value: string) {
    await this.firstNameInput.fill(value);
  }

  async fillLastName(value: string) {
    await this.lastNameInput.fill(value);
  }

  async fillEmail(value: string) {
    await this.emailInput.fill(value);
  }

  async fillPassword(value: string) {
    await this.passwordInput.fill(value);
  }

  async uploadAvatar(imagePath: string) {
    await this.avatarTrigger.click();
    await this.fileInput.setInputFiles(imagePath);
    await this.cropperModal.waitFor({ state: "visible", timeout: 10_000 });
    await this.cropperSaveButton.click();
    await this.cropperModal.waitFor({ state: "hidden", timeout: 15_000 });
  }

  async fillAccountForm({
    firstName,
    lastName,
    email,
    password,
    avatarPath,
  }: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    avatarPath?: string;
  }) {
    await this.fillFirstName(firstName);
    await this.fillLastName(lastName);
    await this.fillEmail(email);
    await this.fillPassword(password);

    if (avatarPath) {
      await this.uploadAvatar(avatarPath);
    }
  }

  async createAccount() {
    await this.createAccountButton.click();
  }

  async expectRedirectToSetup(timeout = 15_000) {
    await this.page.waitForURL("**/setup**", { timeout });
  }

  async expectHeadingVisible() {
    await expect(
      this.page.getByRole("heading", { name: "Create An Account" }),
    ).toBeVisible();
  }
}
