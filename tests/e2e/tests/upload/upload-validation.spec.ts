import { test, expect } from "../../fixtures/upload-fixture";
import { generateUserData } from "../../data/factories";
import { waitForPageReady } from "../../utils/a11y";
import path from "path";
import fs from "fs";

const ASSETS_DIR = path.resolve("tests/e2e/fixtures/test-assets");

test.describe("File Upload Validation", () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(ASSETS_DIR)) {
      fs.mkdirSync(ASSETS_DIR, { recursive: true });
    }

    const textFile = path.join(ASSETS_DIR, "test-invalid.txt");
    if (!fs.existsSync(textFile)) {
      fs.writeFileSync(textFile, "This is not an image file", "utf-8");
    }

    const pdfFile = path.join(ASSETS_DIR, "test-invalid.pdf");
    if (!fs.existsSync(pdfFile)) {
      fs.writeFileSync(pdfFile, "%PDF-1.4 fake pdf content for testing", "utf-8");
    }

    const htmlFile = path.join(ASSETS_DIR, "test-invalid.html");
    if (!fs.existsSync(htmlFile)) {
      fs.writeFileSync(htmlFile, "<html><body>not an image</body></html>", "utf-8");
    }
  });

  test.describe("University Card Upload Validation", () => {
    test.beforeEach(async ({ signupPage }) => {
      await signupPage.goto();
      await waitForPageReady(signupPage.page);
    });

    function formError(signupPage: { form: import("@playwright/test").Locator }, message: string) {
      return signupPage.form.getByText(message);
    }

    function formErrorRegex(signupPage: { form: import("@playwright/test").Locator }, pattern: RegExp) {
      return signupPage.form.getByText(pattern);
    }

    test("rejects text file upload", async ({ signupPage }) => {
      const textFilePath = path.join(ASSETS_DIR, "test-invalid.txt");

      await signupPage.universityCardUpload.setInputFiles(textFilePath);

      await expect(
        formErrorRegex(signupPage, /File type.*is not allowed/i),
      ).toBeVisible({ timeout: 10_000 });
    });

    test("rejects PDF file upload", async ({ signupPage }) => {
      const pdfFilePath = path.join(ASSETS_DIR, "test-invalid.pdf");

      await signupPage.universityCardUpload.setInputFiles(pdfFilePath);

      await expect(
        formErrorRegex(signupPage, /File type.*is not allowed/i),
      ).toBeVisible({ timeout: 10_000 });
    });

    test("rejects HTML file as invalid type", async ({ signupPage }) => {
      const htmlFilePath = path.join(ASSETS_DIR, "test-invalid.html");

      await signupPage.universityCardUpload.setInputFiles(htmlFilePath);

      await expect(
        formErrorRegex(signupPage, /File type.*is not allowed/i),
      ).toBeVisible({ timeout: 10_000 });
    });

    test("shows validation message for each invalid file attempt", async ({
      signupPage,
    }) => {
      const textFilePath = path.join(ASSETS_DIR, "test-invalid.txt");
      const pdfFilePath = path.join(ASSETS_DIR, "test-invalid.pdf");
      const userData = generateUserData();

      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);

      await signupPage.universityCardUpload.setInputFiles(textFilePath);
      await expect(
        formErrorRegex(signupPage, /File type.*is not allowed/i),
      ).toBeVisible({ timeout: 10_000 });

      await signupPage.universityCardUpload.setInputFiles(pdfFilePath);
      await expect(
        formErrorRegex(signupPage, /File type.*is not allowed/i),
      ).toBeVisible({ timeout: 10_000 });
    });

    test("accepts valid image file without error", async ({
      signupPage,
    }) => {
      const userData = generateUserData();

      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);

      await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

      await expect(signupPage.page.getByAltText("Uploaded file")).toBeVisible({
        timeout: 15_000,
      });

      const errorMessages = signupPage.form.locator("text=/File type.*is not allowed|Please select an image file/i");
      await expect(errorMessages).toHaveCount(0);
    });
  });

  test.describe("Avatar Upload Validation", () => {
    test.beforeEach(async ({ signinPage }) => {
      await signinPage.goto();
      await signinPage.signIn(
        process.env.USER_TEST_EMAIL || "makimadena891@gmail.com",
        process.env.USER_TEST_PASSWORD || "makimadena123",
      );
    });

    test("rejects non-image file in avatar upload", async ({
      page,
      profilePage,
    }) => {
      await profilePage.goto();
      await waitForPageReady(page);

      const fileChooserPromise = page.waitForEvent("filechooser");
      await profilePage.avatarTrigger.click();
      const fileChooser = await fileChooserPromise;

      const textFilePath = path.join(ASSETS_DIR, "test-invalid.txt");
      await fileChooser.setFiles(textFilePath);

      await expect(
        page.getByText(/Invalid file type/i).or(
          page.getByText(/File type.*is not allowed/i),
        ).first(),
      ).toBeVisible({ timeout: 10_000 });

      await expect(profilePage.cropperModal).not.toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe("Form Validation with Upload Errors", () => {
    test("sign-up form cannot submit without university card", async ({
      signupPage,
    }) => {
      const userData = generateUserData();

      await signupPage.goto();
      await waitForPageReady(signupPage.page);

      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);

      await signupPage.submit();

      await expect(
        signupPage.page.getByText(/University card is required/i),
      ).toBeVisible({ timeout: 10_000 });
    });
  });
});
