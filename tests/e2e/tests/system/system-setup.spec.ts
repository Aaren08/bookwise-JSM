import { test, expect } from "../../fixtures/setup-fixture";
import { Page } from "@playwright/test";
import { AccountPage } from "../../pages/system/account.page";
import { SetupPage } from "../../pages/system/setup.page";
import {
  generateSetupCredentials,
  setupFormDataFromConfig,
  resetToFreshState,
  verifyAppSettings,
  getAppSettings,
  getUserByEmail,
  verifyOwnerRole,
  setupConsoleListeners,
  captureRedirects,
  assertNoRedirectLoop,
  assertStableRoute,
  SetupConfigValues,
} from "../../helpers/setup-helpers";
import { waitForPageReady } from "../../utils/a11y";

const AVATAR_PATH = "tests/e2e/data/avatar-id.png";

export async function mockSetupRoutes(page: Page) {
  await page.route("**/api/auth/imagekit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        signature: "mock_setup_signature",
        expire: Math.floor(Date.now() / 1000) + 3600,
        token: "mock_setup_token",
        publicKey: "mock_setup_public_key",
      }),
    });
  });

  await page.route("https://upload.imagekit.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://ik.imagekit.io/tests/e2e/data/avatar-id.png",
        fileId: "mock_file_id_setup",
      }),
    });
  });

  const PLACEHOLDER_1x1_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  await page.route("https://ik.imagekit.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(PLACEHOLDER_1x1_PNG, "base64"),
    });
  });

  await page.route("**/_next/image*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(PLACEHOLDER_1x1_PNG, "base64"),
    });
  });
}

test.describe("System Setup - Unified Flow", () => {
  test.describe.configure({ mode: "serial" });

  let page: Page;
  let accountPage: AccountPage;
  let setupPage: SetupPage;
  let credentials: ReturnType<typeof generateSetupCredentials>;
  let consoleWatcher: ReturnType<typeof setupConsoleListeners>;

  const customConfig: SetupConfigValues = {
    universityName: "Oakbridge Institute of Technology (OIT)",
    websiteUrl: "https://oakbridge-tech.edu",
    supportEmail: "library@oakbridge-tech.edu",
    borrowDurationDays: 14,
  };

  test.beforeAll(async ({ browser }) => {
    await resetToFreshState();
    const context = await browser.newContext();
    page = await context.newPage();
    accountPage = new AccountPage(page);
    setupPage = new SetupPage(page);
    await mockSetupRoutes(page);
    credentials = generateSetupCredentials();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.beforeEach(() => {
    consoleWatcher = setupConsoleListeners(page);
  });

  test.afterEach(() => {
    consoleWatcher.assertNoCriticalErrors();
  });

  // --- Guard Behavior Before Setup ---
  test("1. /admin redirects to /sign-in before auth", async () => {
    const redirects = captureRedirects(page);
    redirects.start();

    await page.goto("/admin", { waitUntil: "load" });
    await assertNoRedirectLoop(page);

    const url = page.url();
    expect(url).toContain("/sign-in");

    redirects.stop();
    expect(
      redirects.entries.length,
      "Should have at least one redirect to sign-in",
    ).toBeGreaterThanOrEqual(1);
  });

  test("2. Root / redirects to /sign-in before auth", async () => {
    await page.goto("/", { waitUntil: "load" });
    await waitForPageReady(page);
    await assertNoRedirectLoop(page);

    const url = page.url();
    expect(url).toContain("/sign-in");
  });

  // --- Happy Path: Account Creation ---
  test("3. Setup entry point /account is accessible on fresh DB", async () => {
    await page.goto("/");
    await assertNoRedirectLoop(page);

    await accountPage.goto();
    await accountPage.expectHeadingVisible();

    await expect(accountPage.firstNameInput).toBeVisible();
    await expect(accountPage.lastNameInput).toBeVisible();
    await expect(accountPage.emailInput).toBeVisible();
    await expect(accountPage.passwordInput).toBeVisible();
    await expect(accountPage.createAccountButton).toBeVisible();
  });

  test("4. Owner account creation succeeds and redirects to /setup", async () => {
    await accountPage.fillAccountForm({
      firstName: credentials.firstName,
      lastName: credentials.lastName,
      email: credentials.email,
      password: credentials.password,
      avatarPath: AVATAR_PATH,
    });

    await accountPage.createAccount();
    await accountPage.expectRedirectToSetup();

    const url = page.url();
    expect(url).toContain("/setup");
  });

  // --- Happy Path: System Config ---
  test("5. Complete setup wizard end-to-end", async () => {
    await page.waitForLoadState("networkidle");
    await setupPage.expectOnQuestion(0);

    const config = setupFormDataFromConfig(customConfig);
    await setupPage.fillAndSubmit(config);

    await setupPage.expectRedirectToAdmin();
    await setupPage.expectAdminDashboardLoaded();
  });

  // --- Persistence & DB Integrity ---
  test("6. DB settings and roles are persisted correctly", async () => {
    await verifyAppSettings(customConfig);
    await verifyOwnerRole(credentials.email);

    const settings = await getAppSettings();
    expect(settings!.version).toBe(1);
    expect(settings!.initializedAt).not.toBeNull();
    expect(settings!.setupCompletedAt).not.toBeNull();

    const initializedAt = new Date(
      settings!.initializedAt as unknown as string,
    ).getTime();
    const setupCompletedAt = new Date(
      settings!.setupCompletedAt as unknown as string,
    ).getTime();
    expect(initializedAt).toBeGreaterThan(0);
    expect(setupCompletedAt).toBeGreaterThanOrEqual(initializedAt);

    const user = await getUserByEmail(credentials.email);
    expect(settings!.setupCompletedBy).toBe(user!.id);
    expect(user!.sessionVersion).toBe(1);
  });

  // --- UI Validation ---
  test("7. Admin dashboard loads with branding after setup", async () => {
    await page.goto("/admin");
    await page.waitForLoadState("load");

    await setupPage.expectBrandingVisible(customConfig.universityName);

    // Check sidebar persistence
    const sidebar = page.locator(".admin-sidebar");
    await expect(sidebar).toBeVisible();
  });

  test("8. Session persists across navigation after setup", async () => {
    await page.goto("/");
    await page.waitForLoadState("load");

    await assertNoRedirectLoop(page);
    expect(page.url()).toContain("/");
  });

  // --- Post-Setup Guard Checks ---
  test("9. /account is no longer accessible after setup", async () => {
    await page.goto("/account", { waitUntil: "load" });
    await waitForPageReady(page);

    await assertStableRoute(page, "/admin");
    expect(page.url()).toContain("/admin");
  });

  test("10. /setup is no longer accessible after setup", async () => {
    await page.goto("/setup", { waitUntil: "load" });
    await waitForPageReady(page);

    await assertStableRoute(page, "/admin");
    expect(page.url()).toContain("/admin");
  });

  test("11. POST /api/setup returns 409 after initialization", async () => {
    const response = await page.request.post("/api/setup", {
      data: {
        fullName: "Unauthorized User",
        email: "attacker@evil.com",
        password: "password123!",
        borrowDurationDays: 14,
        supportEmail: "attacker@evil.com",
        websiteUrl: "https://evil.com",
        universityName: "Evil University",
      },
    });

    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already been completed");
  });

  test("12. Unauthorized users cannot reconfigure app settings", async () => {
    const settingsBefore = await getAppSettings();

    const response = await page.request.post("/api/setup", {
      data: {
        fullName: "Another Admin",
        email: "another@evil.com",
        password: "password123!",
        borrowDurationDays: 7,
        supportEmail: "another@evil.com",
        websiteUrl: "https://another-evil.com",
        universityName: "Another University",
      },
    });

    expect(response.status()).toBe(409);

    const settingsAfter = await getAppSettings();
    expect(settingsAfter!.universityName).toBe(settingsBefore!.universityName);
  });

  test("13. Route guard prevents unauthorized access to /admin without session", async () => {
    // Clear cookies to simulate logged out user
    await page.context().clearCookies();

    await page.goto("/admin", { waitUntil: "load" });
    await waitForPageReady(page);

    const url = page.url();
    expect(url).toContain("/sign-in");
  });
});
