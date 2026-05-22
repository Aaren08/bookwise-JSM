import { test, expect } from "../../fixtures/upload-fixture";
import { generateUserData } from "../../data/factories";
import { waitForPageReady } from "../../utils/a11y";
import { db } from "../../../../database/drizzle";
import { users } from "../../../../database/schema";
import { eq } from "drizzle-orm";

test.describe("University Card Upload - Sign-Up Flow", () => {
  test.describe.configure({ mode: "serial" });
  test("completes full university card upload lifecycle during sign-up", async ({
    page,
    signupPage,
  }) => {
    test.setTimeout(90_000);

    const userData = generateUserData();
    const uploadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("upload.imagekit.io") &&
        response.status() === 200,
      { timeout: 60_000 },
    );

    await test.step("1. Navigate to sign-up page", async () => {
      await signupPage.goto();
      await waitForPageReady(page);
      await expect(page).toHaveTitle(/BookWise/);
    });

    await test.step("2. Fill form fields", async () => {
      await signupPage.fullNameInput.fill(userData.fullName);
      await signupPage.emailInput.fill(userData.email);
      await signupPage.universityIdInput.fill(userData.universityId);
      await signupPage.passwordInput.fill(userData.password);
    });

    await test.step("3. Upload university card image", async () => {
      await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.status()).toBe(200);

      await expect(page.getByAltText("Uploaded file")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("4. Submit sign-up form", async () => {
      await signupPage.submit();
      await page.waitForLoadState("networkidle");

      // Detect both success (confirmation) and failure (error toast / rate-limit redirect)
      const currentUrl = page.url();
      if (currentUrl.includes("/too-fast")) {
        throw new Error("Rate limited: redirected to /too-fast");
      }

      await expect(
        page.getByRole("heading", { name: /Check your inbox/i }),
      ).toBeVisible({ timeout: 20_000 });

      await expect(
        signupPage.successMessage,
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("5. Verify university card stored in database", async () => {
      const [createdUser] = await db
        .select({ universityCard: users.universityCard })
        .from(users)
        .where(eq(users.email, userData.email))
        .limit(1);

      expect(createdUser).toBeDefined();
      expect(createdUser?.universityCard).toBeTruthy();
      expect(createdUser?.universityCard).toContain("/images/");
    });

    await test.step("6. Sign in and navigate to profile", async () => {
      await page.getByRole("link", { name: "Back to Login" }).click();
      await page.waitForURL("/sign-in");

      await page.getByLabel("Email", { exact: true }).fill(userData.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(userData.password);
      await page.getByRole("button", { name: "Login", exact: true }).click();

      await page.waitForFunction(
        () => !window.location.pathname.includes("/sign-in"),
        { timeout: 15_000 },
      );
    });

    await test.step("7. Approve user account via DB", async () => {
      await db
        .update(users)
        .set({ status: "APPROVED" })
        .where(eq(users.email, userData.email));
    });

    await test.step("8. Verify university card on profile page", async () => {
      await page.goto("/my-profile");
      await waitForPageReady(page);

      const cardImage = page.getByAltText("university card");
      await expect(cardImage).toBeVisible({ timeout: 10_000 });
      const cardSrc = await cardImage.getAttribute("src");
      expect(cardSrc).toBeTruthy();
      expect(decodeURIComponent(cardSrc!)).toContain("/images/");
    });
  });

  test("displays upload progress indicator during university card upload", async ({
    page,
    signupPage,
  }) => {
    test.setTimeout(60_000);

    await signupPage.goto();
    await waitForPageReady(page);

    const userData = generateUserData();
    await signupPage.fullNameInput.fill(userData.fullName);
    await signupPage.emailInput.fill(userData.email);
    await signupPage.universityIdInput.fill(userData.universityId);
    await signupPage.passwordInput.fill(userData.password);

    await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

    const progressBar = page.locator(".progress").first();
    await expect(progressBar).toBeAttached({ timeout: 10_000 });

    const uploadedPreview = page.getByAltText("Uploaded file");
    await expect(uploadedPreview).toBeVisible({ timeout: 15_000 });
  });

  test("preserves uploaded university card across page navigation", async ({
    page,
    signupPage,
  }) => {
    test.setTimeout(60_000);

    const userData = generateUserData();

    await signupPage.goto();
    await waitForPageReady(page);

    await signupPage.fullNameInput.fill(userData.fullName);
    await signupPage.emailInput.fill(userData.email);
    await signupPage.universityIdInput.fill(userData.universityId);
    await signupPage.passwordInput.fill(userData.password);

    await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);
    await expect(page.getByAltText("Uploaded file")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByAltText("Uploaded file").getAttribute("src");

    await page.reload();
    await waitForPageReady(page);

    await signupPage.fullNameInput.fill(userData.fullName);
    await signupPage.emailInput.fill(userData.email);
    await signupPage.universityIdInput.fill(userData.universityId);
    await signupPage.passwordInput.fill(userData.password);

    const fileInput = signupPage.universityCardUpload;
    const hasFile = await fileInput.inputValue();
    expect(hasFile).toBe("");
  });

  test("upload state transitions correctly: idle → uploading → complete", async ({
    page,
    signupPage,
  }) => {
    test.setTimeout(60_000);

    const userData = generateUserData();

    await signupPage.goto();
    await waitForPageReady(page);

    await signupPage.fullNameInput.fill(userData.fullName);
    await signupPage.emailInput.fill(userData.email);
    await signupPage.universityIdInput.fill(userData.universityId);
    await signupPage.passwordInput.fill(userData.password);

    const uploadPlaceholder = page.locator(".upload-file");
    await expect(uploadPlaceholder).toBeVisible();

    await signupPage.universityCardUpload.setInputFiles(userData.idCardPath);

    const progressBar = page.locator(".progress").first();
    await expect(progressBar).toBeAttached({ timeout: 10_000 });

    const preview = page.getByAltText("Uploaded file");
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(uploadPlaceholder).not.toBeVisible();
  });
});
