import { Page, Locator, expect } from "@playwright/test";

export class SignupPage {
  readonly page: Page;
  readonly fullNameInput: Locator;
  readonly emailInput: Locator;
  readonly universityIdInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly universityCardUpload: Locator;
  readonly checkInboxHeading: Locator;
  readonly successMessage: Locator;
  readonly backToLoginButton: Locator;
  readonly form: Locator;
  readonly confirmationContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    // Semantic locators using exact matching to ensure robustness and avoid strict mode violations
    this.fullNameInput = page.getByLabel("Full name", { exact: true });
    this.emailInput = page.getByLabel("Email", { exact: true });
    this.universityIdInput = page.getByLabel("University ID Number", { exact: true });
    this.passwordInput = page.getByLabel("Password", { exact: true });
    this.universityCardUpload = page.locator("input[type='file']");
    this.submitButton = page.getByRole("button", { name: "Sign Up", exact: true });
    this.checkInboxHeading = page.locator("h1.confirmation-title");
    this.successMessage = page.locator("p.confirmation-subtitle");
    this.backToLoginButton = page.locator(".confirmation-link-btn");
    this.form = page.locator("form");
    this.confirmationContainer = page.locator("main").filter({ has: this.checkInboxHeading });
  }

  async goto() {
    await this.page.goto("/sign-up");
  }

  async fillSignupForm(data: {
    fullName: string;
    email: string;
    password: string;
    idCardPath?: string;
    universityId?: string;
  }) {
    await this.fullNameInput.fill(data.fullName);
    await this.emailInput.fill(data.email);
    if (data.universityId) {
      await this.universityIdInput.fill(data.universityId);
    }
    await this.passwordInput.fill(data.password);

    // Simulate file upload (assuming a standard input type="file" underneath)
    if (data.idCardPath) {
      await this.universityCardUpload.setInputFiles(data.idCardPath);
      // Wait for custom upload complete indicator (the uploaded file image preview)
      await expect(this.page.getByAltText("Uploaded file")).toBeVisible();
    }
  }

  async submit() {
    await this.submitButton.click();
  }

  async expectSuccess() {
    // Web-first assertion: waits automatically until the condition is met or timeout
    await expect(this.checkInboxHeading).toBeVisible({ timeout: 15000 });
    await expect(this.successMessage).toBeVisible();
    await expect(this.backToLoginButton).toBeVisible();
  }
}
