import { expect, Page } from "@playwright/test";

export class SigninPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/sign-in");
    await this.ensureSignInFormVisible();
  }

  async signIn(email: string, password: string) {
    await this.ensureSignInFormVisible();

    const emailInput = this.page.getByLabel("Email", { exact: true });
    const passwordInput = this.page.getByLabel("Password", { exact: true });

    await emailInput.fill(email);
    await passwordInput.fill(password);
    await this.page.getByRole("button", { name: "Login", exact: true }).click();

    await this.page.waitForFunction(
      () => !window.location.pathname.includes("/sign-in"),
      { timeout: 15_000 },
    );
  }

  private async ensureSignInFormVisible() {
    const emailInput = this.page.getByLabel("Email", { exact: true });

    if (await emailInput.isVisible().catch(() => false)) {
      return;
    }

    const logoutButton = this.page.getByRole("button", {
      name: "Logout",
      exact: true,
    });

    if (await logoutButton.isVisible().catch(() => false)) {
      await logoutButton.click();
      await this.page.goto("/sign-in");
    }

    await expect(emailInput).toBeVisible({ timeout: 15_000 });
  }
}
