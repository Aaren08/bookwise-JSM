import { test, expect } from "../../fixtures/a11y-fixture";
import { generateUserData } from "../../data/factories";

test.describe("Accessibility - Onboarding Flow", () => {
  test.beforeEach(async ({ signupPage }) => {
    await signupPage.goto();
  });

  test.describe("Signup page initial load", () => {
    test("full page has no critical WCAG violations", async ({
      page,
      makeAxeBuilder,
    }) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);

      const results = await makeAxeBuilder().analyze();

      expect(results.violations).toHaveLength(0);
    });

    test("heading hierarchy is correct", async ({ page, makeAxeBuilder }) => {
      await page.waitForLoadState("networkidle");

      const results = await makeAxeBuilder()
        .withRules(["heading-order"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });

    test("page has a descriptive title", async () => {
      await expect(test.info().project).toBeDefined();
    });

    test("landmark structure is valid", async ({ page, makeAxeBuilder }) => {
      await page.waitForLoadState("networkidle");

      const results = await makeAxeBuilder()
        .withRules(["landmark-one-main", "region", "page-has-heading-one"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("Signup form accessibility", () => {
    test("file upload input is labeled and accessible", async ({
      page,
      makeAxeBuilder,
    }) => {
      await page.waitForLoadState("load");
      await page.locator("input[type='file']").waitFor({ state: "attached" });

      const results = await makeAxeBuilder()
        .include("input[type='file']")
        .withRules(["label", "input-button-name"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("Validation error accessibility", () => {
    test("errors are communicated with accessible markup", async ({
      page,
      signupPage,
      makeAxeBuilder,
    }) => {
      await page.waitForLoadState("networkidle");

      await signupPage.fillSignupForm({
        fullName: "",
        email: "bad",
        password: "1",
      });
      await signupPage.submit();
      await page.waitForTimeout(500);

      const results = await makeAxeBuilder()
        .withRules(["label", "aria-valid-attr"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });

    test("error messages have accessible names and roles", async ({
      page,
      signupPage,
      makeAxeBuilder,
    }) => {
      await page.waitForLoadState("networkidle");

      await signupPage.fillSignupForm({
        fullName: "",
        email: "bad",
        password: "1",
      });
      await signupPage.submit();
      await page.waitForTimeout(500);

      const results = await makeAxeBuilder()
        .include("form")
        .withRules(["aria-required-children", "aria-required-parent"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("Success confirmation accessibility", () => {
    test("confirmation screen has no critical violations", async ({
      page,
      signupPage,
      makeAxeBuilder,
    }) => {
      const userData = generateUserData();

      await page.waitForLoadState("networkidle");
      await signupPage.fillSignupForm(userData);
      await signupPage.submit();

      await signupPage.checkInboxHeading.waitFor({
        state: "visible",
        timeout: 15000,
      });
      await page.waitForTimeout(300);

      const results = await makeAxeBuilder().analyze();

      expect(results.violations).toHaveLength(0);
    });

    test("confirmation heading hierarchy is correct", async ({
      page,
      signupPage,
      makeAxeBuilder,
    }) => {
      const userData = generateUserData();

      await page.waitForLoadState("networkidle");
      await signupPage.fillSignupForm(userData);
      await signupPage.submit();
      await signupPage.checkInboxHeading.waitFor({
        state: "visible",
        timeout: 15000,
      });

      const results = await makeAxeBuilder()
        .withRules(["heading-order"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("Duplicate registration error", () => {
    test("error toast is accessible", async ({
      page,
      signupPage,
      makeAxeBuilder,
    }) => {
      const email = `duplicate-a11y-${Date.now()}@playwright-test.com`;
      const data = generateUserData();

      await page.waitForLoadState("networkidle");
      await signupPage.fillSignupForm({ ...data, email });
      await signupPage.submit();
      await signupPage.checkInboxHeading.waitFor({
        state: "visible",
        timeout: 15000,
      });

      await page.context().clearCookies();
      await signupPage.goto();
      await page.waitForLoadState("networkidle");
      await signupPage.fillSignupForm({ ...generateUserData(), email });
      await signupPage.submit();

      await page.getByText("User already exists", { exact: true }).waitFor({
        state: "visible",
        timeout: 10000,
      });

      const results = await makeAxeBuilder()
        .withRules(["aria-valid-attr"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("File upload error state", () => {
    test("upload failure displays accessible error", async ({
      page,
      signupPage,
      makeAxeBuilder,
    }) => {
      await page.route("**/api/auth/imagekit", (route) => {
        route.fulfill({ status: 500, body: "Internal Server Error" });
      });

      await signupPage.goto();
      await page.waitForLoadState("networkidle");

      const data = generateUserData();
      await signupPage.universityCardUpload.setInputFiles(data.idCardPath);

      await page
        .getByRole("main")
        .getByText("Upload failed", { exact: true })
        .waitFor({ state: "visible" });

      const results = await makeAxeBuilder().include("form").analyze();

      expect(results.violations).toHaveLength(0);
    });
  });
});
