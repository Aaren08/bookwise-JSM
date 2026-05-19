import { Page } from "@playwright/test";

export class SigninPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/sign-in");
  }

  async signIn(email: string, password: string) {
    await this.page.getByLabel("Email", { exact: true }).fill(email);
    await this.page.getByLabel("Password", { exact: true }).fill(password);
    await this.page.getByRole("button", { name: "Login", exact: true }).click();
    await this.page.waitForFunction(
      () => !window.location.pathname.includes("/sign-in"),
      { timeout: 15_000 },
    );
  }
}
