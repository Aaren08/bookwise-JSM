import { Page, expect } from "@playwright/test";
import { db } from "../../../database/drizzle";
import { appSettings, users } from "../../../database/schema";
import { sql, eq } from "drizzle-orm";
import { clearCachedSetupState } from "../../../lib/global/setup-cache";
import crypto from "crypto";

export const SETUP_ADMIN_EMAIL_DOMAIN = "playwright-setup-test.com";

export interface SetupAdminCredentials {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  password: string;
}

export interface SetupConfigValues {
  universityName: string;
  websiteUrl: string;
  supportEmail: string;
  borrowDurationDays: number;
}

export const DEFAULT_SETUP_CONFIG: SetupConfigValues = {
  universityName: "Playwright University (PWU)",
  websiteUrl: "https://playwright-university.edu",
  supportEmail: "support@playwright-university.edu",
  borrowDurationDays: 21,
};

export function generateSetupCredentials(): SetupAdminCredentials {
  const uuid = crypto.randomUUID().slice(0, 8);
  return {
    firstName: "Test",
    lastName: `Admin-${uuid}`,
    fullName: `Test Admin-${uuid}`,
    email: `setup-e2e-${uuid}@${SETUP_ADMIN_EMAIL_DOMAIN}`,
    password: "SetupAdmin123!",
  };
}

export function setupFormDataFromConfig(
  config?: Partial<SetupConfigValues>,
): {
  universityName: string;
  websiteUrl: string;
  supportEmail: string;
  borrowDurationDays: string;
} {
  const merged = { ...DEFAULT_SETUP_CONFIG, ...config };
  return {
    universityName: merged.universityName,
    websiteUrl: merged.websiteUrl,
    supportEmail: merged.supportEmail,
    borrowDurationDays: String(merged.borrowDurationDays),
  };
}

let initialized = false;

export async function ensureFreshDatabaseState() {
  if (initialized) return;
  await resetToFreshState();
  initialized = true;
}

export async function resetToFreshState() {
  try {
    await db.execute(sql`
      UPDATE app_settings
      SET setup_completed_by = NULL
      WHERE id = true
    `);
    await db.execute(sql`
      DELETE FROM app_settings WHERE id = true
    `);
    await db.execute(sql`
      DELETE FROM users
      WHERE email LIKE ${`%@${SETUP_ADMIN_EMAIL_DOMAIN}`}
    `);
    await db.execute(sql`DELETE FROM setup_events`);

    try {
      await clearCachedSetupState();
    } catch {
      // Redis not available — cache will be repopulated on first request
    }
  } catch (error) {
    console.error("[setup-helpers] resetToFreshState failed:", error);
    throw error;
  }
}

export async function getAppSettings() {
  const [settings] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, true))
    .limit(1);
  return settings ?? null;
}

export async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user ?? null;
}

export async function verifyAppSettings(expected: SetupConfigValues) {
  const settings = await getAppSettings();
  expect(settings, "app_settings row should exist").not.toBeNull();

  expect(settings!.setupCompleted).toBe(true);
  expect(settings!.initializedAt).not.toBeNull();
  expect(settings!.setupCompletedAt).not.toBeNull();
  expect(settings!.setupCompletedBy).not.toBeNull();

  expect(settings!.universityName).toBe(expected.universityName);
  expect(settings!.websiteUrl).toBe(expected.websiteUrl);
  expect(settings!.supportEmail).toBe(expected.supportEmail);
  expect(settings!.borrowDurationDays).toBe(expected.borrowDurationDays);
}

export async function verifyOwnerRole(email: string) {
  const user = await getUserByEmail(email);
  expect(user, "Owner user should exist").not.toBeNull();
  expect(user!.role).toBe("ADMIN");
  expect(user!.status).toBe("APPROVED");
  expect(user!.sessionVersion).toBe(1);
}

export async function verifyAppSettingsNotExist() {
  const settings = await getAppSettings();
  expect(settings).toBeNull();
}

export async function verifyUserNotExist(email: string) {
  const user = await getUserByEmail(email);
  expect(user).toBeNull();
}

export type RedirectEntry = {
  from: string;
  to: string;
  status: number;
};

export function captureRedirects(page: Page): {
  entries: RedirectEntry[];
  start: () => void;
  stop: () => void;
} {
  const entries: RedirectEntry[] = [];

  const handler = (response: import("@playwright/test").Response) => {
    if (response.status() >= 300 && response.status() < 400) {
      const Location = response.headers()["location"];
      if (Location) {
        entries.push({
          from: response.url(),
          to: Location,
          status: response.status(),
        });
      }
    }
  };

  return {
    entries,
    start: () => page.on("response", handler),
    stop: () => page.removeListener("response", handler),
  };
}

export async function assertNoRedirectLoop(page: Page, timeout = 10_000) {
  const visited = new Set<string>();
  let currentUrl = page.url();

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (visited.has(currentUrl)) {
      throw new Error(
        `Redirect loop detected at URL: ${currentUrl}. ` +
          `Visited chain: ${[...visited].join(" → ")}`,
      );
    }
    visited.add(currentUrl);

    await page.waitForTimeout(200);
    const nextUrl = page.url();
    if (nextUrl === currentUrl) break;
    currentUrl = nextUrl;
  }
}

export async function assertStableRoute(
  page: Page,
  expectedUrl: string,
  timeout = 10_000,
) {
  await expect
    .poll(
      async () => {
        const url = page.url();
        return url.includes(expectedUrl) ? url : null;
      },
      { timeout, message: `Expected route to stabilize at ${expectedUrl}` },
    )
    .not.toBeNull();
}

export function setupConsoleListeners(page: Page) {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`[Console Error] ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    errors.push(`[Page Error] ${err.message}`);
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`[HTTP ${response.status()}] ${response.url()}`);
    }
  });

  return {
    errors,
    getCriticalErrors: () =>
      errors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("EventSource") &&
          !e.includes("/api/auth/session") &&
          !e.includes("Failed to refresh admin dashboard"),
      ),
    assertNoCriticalErrors: () => {
      const critical = errors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("EventSource") &&
          !e.includes("/api/auth/session") &&
          !e.includes("Failed to refresh admin dashboard"),
      );
      expect(
        critical,
        `Unexpected errors: ${critical.join("; ")}`,
      ).toHaveLength(0);
    },
  };
}
