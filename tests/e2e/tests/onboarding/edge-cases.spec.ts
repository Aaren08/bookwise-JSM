import { test, expect } from "../../fixtures/base-fixture";
import { generateUserData } from "../../data/factories";
import { checkA11y, waitForPageReady } from "../../utils/a11y";

test.describe("User Onboarding - Edge Cases", () => {
  test("Displays validation errors for invalid email and weak password", async ({
    page,
    signupPage,
  }) => {
    await signupPage.goto();
    await waitForPageReady(page);

    // Attempt invalid data
    await signupPage.fillSignupForm({
      fullName: "John Doe",
      email: "invalid-email",
      password: "123", // Too short
    });

    await signupPage.submit();

    // Verify UI validation errors appear (Assuming Zod/React Hook Form)
    await expect(
      signupPage.page.getByText("Invalid email address"),
    ).toBeVisible();
    await expect(
      signupPage.page.getByText("Password must be at least 8 characters"),
    ).toBeVisible();

    // Scoped scan on the form with validation errors visible
    // WHY: error messages must be programmatically associable to their inputs
    // Mitigates: WCAG 3.3.1 (Error Identification), 3.3.3 (Error Suggestion), 4.1.3 (Status Messages)
    await checkA11y(page, {
      include: ["form"],
      rules: ["label", "aria-valid-attr"],
      testInfo: test.info(),
    });
  });

  test("Handles duplicate account registration gracefully", async ({
    page,
    signupPage,
  }) => {
    const existingEmail = `duplicate-${Date.now()}@playwright-test.com`;

    // 1. First, register the user to ensure they exist in the database
    await signupPage.goto();
    await waitForPageReady(page);
    await signupPage.fillSignupForm({
      ...generateUserData(),
      email: existingEmail,
    });
    await signupPage.submit();
    await signupPage.expectSuccess();

    // 2. Clear cookies/session so we are unauthenticated before trying to register again
    await page.context().clearCookies();

    // 3. Try to register again with the same email
    await signupPage.goto();
    await waitForPageReady(page);
    await signupPage.fillSignupForm({
      ...generateUserData(),
      email: existingEmail,
    });
    await signupPage.submit();

    // The backend should reject it, and UI should show a graceful error toast
    await expect(
      page.getByText("User already exists", { exact: true }),
    ).toBeVisible();

    // Scoped scan on the error toast after async UI update
    // WHY: dynamically rendered error messages must be announced by screen readers
    // Mitigates: WCAG 4.1.3 (Status Messages), 3.3.1 (Error Identification)
    await checkA11y(page, {
      exclude: ["form"],
      rules: ["aria-valid-attr"],
      testInfo: test.info(),
    });
  });

  test("Gracefully handles file upload failure", async ({
    page,
    signupPage,
  }) => {
    // Intercept the credentials retrieval endpoint and force a 500 failure
    await page.route("**/api/auth/imagekit", (route) => {
      route.fulfill({ status: 500, body: "Internal Server Error" });
    });

    await signupPage.goto();
    await waitForPageReady(page);
    const data = generateUserData();
    await signupPage.universityCardUpload.setInputFiles(data.idCardPath);

    // Expect the FileUpload component/AuthForm to handle and display the error state under the field
    await expect(
      page.getByRole("main").getByText("Upload failed", { exact: true }),
    ).toBeVisible();

    // Scoped scan on the form after upload failure
    // WHY: file upload errors must be communicated to assistive technology
    // Mitigates: WCAG 1.1.1 (Non-text Content), 3.3.1 (Error Identification)
    await checkA11y(page, {
      include: ["form"],
      testInfo: test.info(),
    });
  });
});
