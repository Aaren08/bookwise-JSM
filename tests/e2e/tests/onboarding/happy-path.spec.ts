import { test, expect } from "../../fixtures/base-fixture";
import { generateUserData } from "../../data/factories";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq } from "drizzle-orm";
import { checkA11y, waitForPageReady } from "../../utils/a11y";

test.describe("User Onboarding - Happy Path", () => {
  test("New user can complete the entire onboarding flow successfully", async ({
    page,
    signupPage,
  }) => {
    // Increase test timeout for this complex E2E flow involving database updates, mock uploads, and multiple page navigations
    test.setTimeout(60000);

    const userData = generateUserData();

    await test.step("1. Navigate to Sign Up", async () => {
      await signupPage.goto();
      await waitForPageReady(page);

      await expect(page).toHaveTitle(/BookWise/);

      // Full-page scan after initial page load
      // WHY: ensures the entry point is WCAG-compliant before any interaction
      // Mitigates: WCAG 1.3.1 (Info and Relationships), 4.1.2 (Name, Role, Value)
      await checkA11y(page, { testInfo: test.info() });
    });

    await test.step("2. Fill out Account Details and Upload ID", async () => {
      await signupPage.fillSignupForm(userData);

      // Scoped scan on the form after it is populated
      // WHY: form fields with data may trigger dynamic ARIA updates
      // Mitigates: WCAG 3.3.2 (Labels or Instructions), 4.1.2
      await checkA11y(page, {
        include: ["form"],
        testInfo: test.info(),
      });
    });

    await test.step("3. Submit Registration & Verify Success UI", async () => {
      await signupPage.submit();

      // Verify that registration completed successfully and displays the confirmation screen
      await signupPage.expectSuccess();

      // Full-page scan on the confirmation screen
      // WHY: post-submission UI must be accessible to all users
      // Mitigates: WCAG 2.4.6 (Headings and Labels), 3.3.1 (Error Identification)
      await waitForPageReady(page);
      await checkA11y(page, {
        include: [".confirmation-title", ".confirmation-subtitle"],
        testInfo: test.info(),
      });
    });

    await test.step("4. Approve user account (Simulate Admin Approval)", async () => {
      // Simulate admin action by directly approving the newly created user in the database
      await db
        .update(users)
        .set({ status: "APPROVED" })
        .where(eq(users.email, userData.email));
    });

    await test.step("5. Visit user profile page", async () => {
      await page.goto("/my-profile");
    });

    await test.step("6. Assert verification completed", async () => {
      // Once approved by admin, user status changes to APPROVED which renders "Verified Student"
      await expect(page.getByText("Verified Student")).toBeVisible();
    });

    await test.step("7. Continue to homePage", async () => {
      // Use client-side navigation as a best practice for realistic user transitions and to avoid hard navigation aborts
      await page.getByRole("link", { name: "Home" }).click();
      await expect(page).toHaveURL("/");

      // Full-page scan on the home page after navigation
      // WHY: ensure the home page is accessible as the primary landing surface
      // Mitigates: WCAG 1.3.1, 2.4.6, 4.1.2
      await waitForPageReady(page);
      await checkA11y(page, { testInfo: test.info() });
    });
  });
});
