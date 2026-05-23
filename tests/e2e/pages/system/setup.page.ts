import { Page, Locator, expect } from "@playwright/test";
import {
  SetupQuestionId,
  setupQuestions,
} from "../../../../lib/global/essentials/setup-questions";

export interface SetupFormData {
  universityName: string;
  websiteUrl: string;
  supportEmail: string;
  borrowDurationDays: string;
}

export class SetupPage {
  readonly page: Page;

  readonly questionHeading: Locator;
  readonly continueButton: Locator;
  readonly applyButton: Locator;
  readonly editButton: Locator;
  readonly reviewHeading: Locator;
  readonly warningBox: Locator;

  private questionLocators: Record<SetupQuestionId, Locator>;

  constructor(page: Page) {
    this.page = page;

    this.questionHeading = page.locator(".admin-section h1");
    this.continueButton = page.getByRole("button", {
      name: "Continue",
      exact: true,
    });
    this.applyButton = page.getByRole("button", { name: "Apply" });
    this.editButton = page.getByRole("button", { name: "Edit" });
    this.reviewHeading = page.getByRole("heading", {
      name: "Verify your setup",
    });
    this.warningBox = page.locator(".setup-warning-box");

    this.questionLocators = {
      universityName: page.getByPlaceholder("Institute name"),
      websiteUrl: page.getByPlaceholder("https://example.edu"),
      supportEmail: page.getByPlaceholder("support@example.edu"),
      borrowDurationDays: page.getByPlaceholder("14"),
    };
  }

  async expectOnQuestion(index: number) {
    const question = setupQuestions[index];
    await expect(
      this.page.getByText(question.question),
    ).toBeVisible();
  }

  async answerQuestion(id: SetupQuestionId, value: string) {
    const input = this.questionLocators[id];
    await input.waitFor({ state: "visible", timeout: 5_000 });
    await input.fill(value);
  }

  async continue() {
    await this.continueButton.click();
  }

  async answerAllQuestions(data: SetupFormData) {
    for (const question of setupQuestions) {
      await this.expectOnQuestion(
        setupQuestions.indexOf(question),
      );
      await this.answerQuestion(question.id, data[question.id]);
      await this.continue();
    }
  }

  async expectOnReview() {
    await expect(this.reviewHeading).toBeVisible({ timeout: 10_000 });
    await expect(this.warningBox).toBeVisible();
  }

  async expectReviewValue(label: string, value: string) {
    const reviewBox = this.page.locator(".setup-review-box").filter({
      hasText: label,
    });
    await expect(reviewBox).toBeVisible();
    await expect(reviewBox).toContainText(value);
  }

  async submitSetup() {
    await this.continueButton.click();
  }

  async fillAndSubmit(data: SetupFormData) {
    await this.answerAllQuestions(data);
    await this.expectOnReview();

    for (const question of setupQuestions) {
      const labelMap: Record<SetupQuestionId, string> = {
        universityName: "Institute name",
        websiteUrl: "Website URL",
        supportEmail: "Support email",
        borrowDurationDays: "Borrow duration",
      };
      const displayValue =
        question.id === "borrowDurationDays"
          ? `${data.borrowDurationDays} days`
          : data[question.id];
      await this.expectReviewValue(labelMap[question.id], displayValue);
    }

    await this.submitSetup();
  }

  async expectRedirectToAdmin(timeout = 30_000) {
    await this.page.waitForURL("**/admin**", { timeout });
    await this.page.waitForLoadState("networkidle");
  }

  async expectAdminDashboardLoaded() {
    await expect(this.page.locator(".admin-header")).toBeVisible({
      timeout: 15_000,
    });
  }

  async expectBrandingVisible(instituteName: string) {
    await expect(
      this.page.getByText(instituteName).first(),
    ).toBeVisible({ timeout: 10_000 });
  }
}
