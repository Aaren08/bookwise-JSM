import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { db } from "../../../../database/drizzle";
import { users, borrowRecords, books } from "../../../../database/schema";
import { eq, ilike, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { SigninPage } from "../../pages/auth/signin.page";
import {
  createSseInterceptorScript,
  createNetworkDiagnostics,
} from "../../utils/sse";
import {
  acquireLockViaApi,
  releaseLockViaApi,
  expectLockExists,
  expectLockNotExists,
  getLockForRowViaApi,
  expectLockIndicatorVisible,
  expectLockIndicatorNotVisible,
  expectRowButtonsDisabled,
  expectRowButtonsEnabled,
  expectLockAccessibilitySemantics,
  findTableRow,
  LOCKS_API_URL,
  RELEASE_POLL_TIMEOUT,
  TTL_POLL_TIMEOUT,
} from "../../utils/lock";
import type { AdminRealtimeEntity } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

// ---------------------------------------------------------------------------
// Worker isolation
// ---------------------------------------------------------------------------

const WORKER_ID = process.env.TEST_WORKER_INDEX ?? "0";
const TEST_PREFIX = `row-lock-${WORKER_ID}`;
const SUITE_TIMEOUT = 300_000;

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------

const ADMIN_A = {
  email: `${TEST_PREFIX}-admin-a@bookwise-test.com`,
  password: "LockAdminAPass123!",
  fullName: "Lock Admin A",
};

const ADMIN_B = {
  email: `${TEST_PREFIX}-admin-b@bookwise-test.com`,
  password: "LockAdminBPass123!",
  fullName: "Lock Admin B",
};

const ENTITY: AdminRealtimeEntity = "account_requests";

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function ensureAdminExists(admin: {
  email: string;
  password: string;
  fullName: string;
}) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, admin.email))
    .limit(1);

  if (existing.length === 0) {
    const hashed = await bcrypt.hash(admin.password, 10);
    await db.insert(users).values({
      fullName: admin.fullName,
      email: admin.email,
      password: hashed,
      status: "APPROVED",
      role: "ADMIN",
    });
  } else {
    await db
      .update(users)
      .set({ status: "APPROVED", role: "ADMIN" })
      .where(eq(users.email, admin.email));
  }
}

type PendingTestUser = {
  id: string;
  email: string;
  fullName: string;
};

async function createPendingUser(index: number): Promise<PendingTestUser> {
  const email = `${TEST_PREFIX}-pending-${index}@bookwise-test.com`;
  const existing = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(users)
      .set({ status: "PENDING" })
      .where(eq(users.email, email));
    return {
      id: existing[0].id,
      email,
      fullName: existing[0].fullName ?? `Pending User ${index}`,
    };
  }

  const fullName = `Pending User ${index}`;
  const hashed = await bcrypt.hash("PendingPass123!", 10);
  const [inserted] = await db
    .insert(users)
    .values({
      fullName,
      email,
      password: hashed,
      status: "PENDING",
      role: "USER",
      universityId: Math.floor(100000 + Math.random() * 900000).toString(),
    })
    .returning({ id: users.id });

  return { id: inserted.id, email, fullName };
}

async function resetUserToPending(userId: string) {
  await db.update(users).set({ status: "PENDING" }).where(eq(users.id, userId));
}

async function getAdminId(email: string): Promise<string | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user?.id ?? null;
}

async function signIn(page: Page, email: string, password: string) {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.signIn(email, password);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type LockTestFixtures = {
  adminAContext: BrowserContext;
  adminAPage: Page;
  adminBContext: BrowserContext;
  adminBPage: Page;
};

const test = base.extend<LockTestFixtures>({
  adminAContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  adminAPage: async ({ adminAContext }, use) => {
    const page = await adminAContext.newPage();
    await page.addInitScript(createSseInterceptorScript());
    await use(page);
  },
  adminBContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  adminBPage: async ({ adminBContext }, use) => {
    const page = await adminBContext.newPage();
    await page.addInitScript(createSseInterceptorScript());
    await use(page);
  },
});

export { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("Admin Row Locking — Concurrent Edit Prevention", () => {
  test.setTimeout(SUITE_TIMEOUT);

  // Shared test users created once
  let targetUser: PendingTestUser;
  let confirmUser: PendingTestUser;
  let ownerUser1: PendingTestUser;
  let ownerUser2: PendingTestUser;

  test.beforeAll(async () => {
    await ensureAdminExists(ADMIN_A);
    await ensureAdminExists(ADMIN_B);

    targetUser = await createPendingUser(1);
    confirmUser = await createPendingUser(2);
    ownerUser1 = await createPendingUser(3);
    ownerUser2 = await createPendingUser(4);
  });

  test.afterAll(async () => {
    const pattern = `${TEST_PREFIX}%`;
    await db
      .delete(borrowRecords)
      .where(and(ilike(borrowRecords.id, pattern)))
      .catch(() => {});
    await db
      .delete(books)
      .where(ilike(books.title, pattern))
      .catch(() => {});
    await db
      .delete(users)
      .where(ilike(users.email, `${TEST_PREFIX}%`))
      .catch(() => {});
  });

  // ---------------------------------------------------------------------
  // 1. Lock Acquisition — opening edit acquires lock and displays correctly
  // ---------------------------------------------------------------------

  test("Lock Acquisition — opening edit acquires lock and displays correctly", async ({
    adminAPage,
    adminBPage,
  }) => {
    const networkErrors = createNetworkDiagnostics(adminAPage);

    await test.step("1.1 Sign in both admins and navigate to account requests", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(
        adminAPage.getByRole("heading", {
          name: "Account Registration Requests",
        }),
      ).toBeVisible();
      await expect(
        adminBPage.getByRole("heading", {
          name: "Account Registration Requests",
        }),
      ).toBeVisible();
    });

    await test.step("1.2 Target user is visible to both admins", async () => {
      const rowA = findTableRow(adminAPage, targetUser.email);
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expect(rowA).toBeVisible({ timeout: 15_000 });
      await expect(rowB).toBeVisible({ timeout: 15_000 });
    });

    await test.step("1.3 Admin A clicks Approve Account to acquire lock", async () => {
      const approveBtn = findTableRow(adminAPage, targetUser.email).getByRole(
        "button",
        {
          name: "Approve Account",
        },
      );
      await approveBtn.click();

      const modal = adminAPage.getByRole("alertdialog");
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await expect(
        modal.getByRole("heading", { name: "Approve Account Request" }),
      ).toBeVisible();
    });

    await test.step("1.4 Lock exists in backend with correct admin identity", async () => {
      await expectLockExists(
        adminAPage,
        ENTITY,
        targetUser.id,
        ADMIN_A.fullName,
      );
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      expect(lock).not.toBeNull();
      expect(lock!.adminId).toBe(await getAdminId(ADMIN_A.email));
      expect(lock!.adminName).toBe(ADMIN_A.fullName);
      expect(lock!.entity).toBe(ENTITY);
      expect(lock!.entityId).toBe(targetUser.id);
      expect(lock!.token).toBeTruthy();
      expect(lock!.version).toBeGreaterThanOrEqual(1);
    });

    await test.step("1.5 Admin B sees lock indicator with Admin A's name", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorVisible(rowB, ADMIN_A.fullName);
    });

    await test.step("1.6 Cleanup — Admin A releases lock", async () => {
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      if (lock) {
        await releaseLockViaApi(adminAPage, ENTITY, targetUser.id, lock.token);
      }
      await expectLockNotExists(adminAPage, ENTITY, targetUser.id);
    });

    await test.step("1.7 No critical network errors", async () => {
      const critical = networkErrors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("AbortError") &&
          !e.includes("EventSource") &&
          !e.includes("hydration"),
      );
      expect(critical, `Network errors: ${critical.join("; ")}`).toHaveLength(
        0,
      );
    });
  });

  // ---------------------------------------------------------------------
  // 2. Concurrent Edit Prevention — Admin B cannot edit locked row
  // ---------------------------------------------------------------------

  test("Concurrent Edit Prevention — Admin B cannot edit locked row", async ({
    adminAPage,
    adminBPage,
  }) => {
    await test.step("2.1 Sign in and navigate both admins", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
      await expect(findTableRow(adminBPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("2.2 Admin A acquires lock via UI", async () => {
      const approveBtn = findTableRow(adminAPage, targetUser.email).getByRole(
        "button",
        {
          name: "Approve Account",
        },
      );
      await approveBtn.click();
      const modal = adminAPage.getByRole("alertdialog");
      await expect(modal).toBeVisible({ timeout: 10_000 });
    });

    await test.step("2.3 Admin B sees lock indicator and disabled buttons", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorVisible(rowB, ADMIN_A.fullName);
      await expectRowButtonsDisabled(rowB);
    });

    await test.step("2.4 Admin B sees disabled buttons — cannot interact via UI", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      const approveBtnB = rowB.getByRole("button", { name: "Approve Account" });

      await expect(approveBtnB).toBeDisabled();

      const modalOnB = adminBPage.getByRole("alertdialog");
      await expect(modalOnB).not.toBeVisible({ timeout: 3_000 });
    });

    await test.step("2.5 Verify lock enforcement via backend — Admin B can't bypass by API", async () => {
      const result = await acquireLockViaApi(adminBPage, ENTITY, targetUser.id);
      expect(result.success).toBe(false);
    });

    await test.step("2.6 Cleanup — Admin A releases lock", async () => {
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      if (lock) {
        const alertDialog = adminAPage.getByRole("alertdialog");
        const closeBtn = alertDialog.getByRole("button", { name: "close" });
        await closeBtn.click();
        await expect(alertDialog).not.toBeVisible({ timeout: 5_000 });
      }
      await expectLockNotExists(adminAPage, ENTITY, targetUser.id);
    });
  });

  // ---------------------------------------------------------------------
  // 3. Lock Release on Modal Close (X button)
  // ---------------------------------------------------------------------

  test("Lock Release on Modal Close — Admin B can edit after Admin A closes", async ({
    adminAPage,
    adminBPage,
  }) => {
    await test.step("3.1 Sign in both admins and navigate", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
      await expect(findTableRow(adminBPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("3.2 Admin A acquires lock (opens modal)", async () => {
      const approveBtn = findTableRow(adminAPage, targetUser.email).getByRole(
        "button",
        {
          name: "Approve Account",
        },
      );
      await approveBtn.click();
      const modal = adminAPage.getByRole("alertdialog");
      await expect(modal).toBeVisible({ timeout: 10_000 });
    });

    await test.step("3.3 Admin B sees lock", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorVisible(rowB, ADMIN_A.fullName);
      await expectRowButtonsDisabled(rowB);
    });

    await test.step("3.4 Admin A closes modal via X button", async () => {
      const closeBtn = adminAPage.getByRole("button", { name: "close" });
      await closeBtn.click();
      await expect(adminAPage.getByRole("alertdialog")).not.toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("3.5 Lock is released — Admin B can acquire lock", async () => {
      await expectLockNotExists(
        adminAPage,
        ENTITY,
        targetUser.id,
        RELEASE_POLL_TIMEOUT,
      );
      const result = await acquireLockViaApi(adminBPage, ENTITY, targetUser.id);
      expect(result.success).toBe(true);
      if (result.lock) {
        await releaseLockViaApi(
          adminBPage,
          ENTITY,
          targetUser.id,
          result.lock.token,
        );
      }
      await expectLockNotExists(
        adminBPage,
        ENTITY,
        targetUser.id,
        RELEASE_POLL_TIMEOUT,
      );
    });
  });

  // ---------------------------------------------------------------------
  // 4. Lock Release on Confirm (Save)
  // ---------------------------------------------------------------------

  test("Lock Release on Confirm — Admin A saves and lock releases", async ({
    adminAPage,
    adminBPage,
  }) => {
    await test.step("4.1 Sign in both admins and navigate", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, confirmUser.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("4.2 Admin A acquires lock and confirms", async () => {
      const approveBtn = findTableRow(adminAPage, confirmUser.email).getByRole(
        "button",
        {
          name: "Approve Account",
        },
      );
      await approveBtn.click();
      const modal = adminAPage.getByRole("alertdialog");
      await expect(modal).toBeVisible({ timeout: 10_000 });
      const confirmBtn = modal.getByRole("button", {
        name: "Approve & Send Confirmation",
      });
      await confirmBtn.click();
      await expect(modal).not.toBeVisible({ timeout: 10_000 });
    });

    await test.step("4.3 Lock is released after confirm", async () => {
      await expectLockNotExists(
        adminAPage,
        ENTITY,
        confirmUser.id,
        RELEASE_POLL_TIMEOUT,
      );
    });

    await test.step("4.4 Admin B sees user removed from pending list (via SSE)", async () => {
      await expect(findTableRow(adminBPage, confirmUser.email)).not.toBeVisible(
        { timeout: 15_000 },
      );
    });

    await test.step("4.5 Reset user for future tests", async () => {
      await resetUserToPending(confirmUser.id);
    });
  });

  // ---------------------------------------------------------------------
  // 5. Heartbeat keeps lock alive
  // ---------------------------------------------------------------------

  test("Heartbeat extends lock — lock remains active during extended editing", async ({
    adminAPage,
    adminBPage,
  }) => {
    test.setTimeout(120_000);

    await test.step("5.1 Sign in both admins and navigate", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("5.2 Admin A acquires lock via API (captures token for heartbeat)", async () => {
      const result = await acquireLockViaApi(adminAPage, ENTITY, targetUser.id);
      expect(result.success).toBe(true);
      expect(result.lock?.token).toBeTruthy();
    });

    await test.step("5.3 Admin B sees lock", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorVisible(rowB, ADMIN_A.fullName);
    });

    await test.step("5.4 Send heartbeats via PATCH — simulate long editing session", async () => {
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      expect(lock).not.toBeNull();

      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 2_000));

        const refreshResult = await adminAPage.request.patch(LOCKS_API_URL, {
          data: { entity: ENTITY, entityId: targetUser.id, token: lock!.token },
        });
        expect(refreshResult.ok(), `Heartbeat ${i + 1} failed`).toBe(true);
      }
    });

    await test.step("5.5 Lock still exists after heartbeats", async () => {
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      expect(lock, "Lock should still exist after heartbeats").not.toBeNull();
    });

    await test.step("5.6 Admin B still sees lock (no premature expiration)", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorVisible(rowB, ADMIN_A.fullName);
      await expectRowButtonsDisabled(rowB);
    });

    await test.step("5.7 Cleanup — release lock", async () => {
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      if (lock) {
        await releaseLockViaApi(adminAPage, ENTITY, targetUser.id, lock.token);
      }
      await expectLockNotExists(adminAPage, ENTITY, targetUser.id);
    });
  });

  // ---------------------------------------------------------------------
  // 6. Auto-Expiration — lock released after TTL when admin disconnects
  // ---------------------------------------------------------------------

  test("Auto-Expiration — stale lock disappears after TTL when owner disconnects", async ({
    adminAPage,
    adminBPage,
  }) => {
    test.setTimeout(180_000);

    await test.step("6.1 Sign in both admins and navigate", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
      await expect(findTableRow(adminBPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("6.2 Admin A acquires lock via UI", async () => {
      const approveBtn = findTableRow(adminAPage, targetUser.email).getByRole(
        "button",
        {
          name: "Approve Account",
        },
      );
      await approveBtn.click();
      const modal = adminAPage.getByRole("alertdialog");
      await expect(modal).toBeVisible({ timeout: 10_000 });
    });

    await test.step("6.3 Verify lock exists and Admin B sees it", async () => {
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      expect(lock, "Lock should exist").not.toBeNull();
    });

    await test.step("6.4 Verify Admin B sees the lock indicator", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorVisible(rowB, ADMIN_A.fullName);
      await expectRowButtonsDisabled(rowB);
    });

    await test.step("6.5 Close Admin A page to stop heartbeat", async () => {
      await adminAPage.close();
    });

    await test.step("6.6 Wait for TTL expiry — lock should auto-release", async () => {
      await expectLockNotExists(
        adminBPage,
        ENTITY,
        targetUser.id,
        TTL_POLL_TIMEOUT,
      );
    });

    await test.step("6.7 Admin B's lock indicator disappears after expiry", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorNotVisible(rowB);
    });

    await test.step("6.8 Admin B can now interact with the row", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectRowButtonsEnabled(rowB);
    });
  });

  // ---------------------------------------------------------------------
  // 7. Ownership Correctness — lock indicator shows correct admin identity
  // ---------------------------------------------------------------------

  test("Ownership Correctness — lock indicators always show correct admin identity", async ({
    adminAPage,
    adminBPage,
  }) => {
    await test.step("7.1 Sign in both admins and navigate", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, ownerUser1.email)).toBeVisible({
        timeout: 15_000,
      });
      await expect(findTableRow(adminAPage, ownerUser2.email)).toBeVisible({
        timeout: 15_000,
      });
      await expect(findTableRow(adminBPage, ownerUser1.email)).toBeVisible({
        timeout: 15_000,
      });
      await expect(findTableRow(adminBPage, ownerUser2.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("7.2 Admin A locks user1, Admin B locks user2", async () => {
      const resultA = await acquireLockViaApi(
        adminAPage,
        ENTITY,
        ownerUser1.id,
      );
      expect(resultA.success).toBe(true);

      const resultB = await acquireLockViaApi(
        adminBPage,
        ENTITY,
        ownerUser2.id,
      );
      expect(resultB.success).toBe(true);
    });

    await test.step("7.3 Wait for lock events to propagate via SSE", async () => {
      await expectLockExists(
        adminAPage,
        ENTITY,
        ownerUser1.id,
        ADMIN_A.fullName,
      );
      await expectLockExists(
        adminAPage,
        ENTITY,
        ownerUser2.id,
        ADMIN_B.fullName,
      );
      await expectLockExists(
        adminBPage,
        ENTITY,
        ownerUser1.id,
        ADMIN_A.fullName,
      );
      await expectLockExists(
        adminBPage,
        ENTITY,
        ownerUser2.id,
        ADMIN_B.fullName,
      );
    });

    await test.step("7.4 Admin A sees correct lock indicators", async () => {
      const row1A = findTableRow(adminAPage, ownerUser1.email);
      const row2A = findTableRow(adminAPage, ownerUser2.email);

      const indicator1A = row1A.locator(".row-lock_badge");
      await expect(indicator1A).toBeVisible();
      await expect(indicator1A).toHaveAttribute(
        "aria-label",
        `Currently being edited by ${ADMIN_A.fullName}`,
      );

      const indicator2A = row2A.locator(".row-lock_badge");
      await expect(indicator2A).toBeVisible();
      await expect(indicator2A).toHaveAttribute(
        "aria-label",
        `Currently being edited by ${ADMIN_B.fullName}`,
      );
    });

    await test.step("7.5 Admin B sees correct lock indicators", async () => {
      const row1B = findTableRow(adminBPage, ownerUser1.email);
      const row2B = findTableRow(adminBPage, ownerUser2.email);

      const indicator1B = row1B.locator(".row-lock_badge");
      await expect(indicator1B).toBeVisible();
      await expect(indicator1B).toHaveAttribute(
        "aria-label",
        `Currently being edited by ${ADMIN_A.fullName}`,
      );

      const indicator2B = row2B.locator(".row-lock_badge");
      await expect(indicator2B).toBeVisible();
      await expect(indicator2B).toHaveAttribute(
        "aria-label",
        `Currently being edited by ${ADMIN_B.fullName}`,
      );
    });

    await test.step("7.6 No cross-contamination — Admin A doesn't own user2's lock", async () => {
      const row2A = findTableRow(adminAPage, ownerUser2.email);
      const indicator2A = row2A.locator(".row-lock_badge");
      await expect(indicator2A).toHaveAttribute(
        "aria-label",
        `Currently being edited by ${ADMIN_B.fullName}`,
      );
    });

    await test.step("7.7 Cleanup — release both locks", async () => {
      const lock1 = await getLockForRowViaApi(
        adminAPage,
        ENTITY,
        ownerUser1.id,
      );
      const lock2 = await getLockForRowViaApi(
        adminBPage,
        ENTITY,
        ownerUser2.id,
      );
      if (lock1) {
        await releaseLockViaApi(adminAPage, ENTITY, ownerUser1.id, lock1.token);
      }
      if (lock2) {
        await releaseLockViaApi(adminBPage, ENTITY, ownerUser2.id, lock2.token);
      }
      await expectLockNotExists(adminAPage, ENTITY, ownerUser1.id);
      await expectLockNotExists(adminAPage, ENTITY, ownerUser2.id);
    });
  });

  // ---------------------------------------------------------------------
  // 8. Accessibility — lock controls have proper semantics
  // ---------------------------------------------------------------------

  test("Accessibility — lock controls have proper screen-reader semantics", async ({
    adminAPage,
    adminBPage,
  }) => {
    await test.step("8.1 Sign in both admins and navigate", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
      await expect(findTableRow(adminBPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("8.2 Admin A acquires lock", async () => {
      const result = await acquireLockViaApi(adminAPage, ENTITY, targetUser.id);
      expect(result.success).toBe(true);
    });

    await test.step("8.3 Admin B lock indicator has correct accessibility attributes", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockAccessibilitySemantics(rowB, ADMIN_A.fullName);
    });

    await test.step("8.4 Verify disabled buttons have proper semantics", async () => {
      const rowB = findTableRow(adminBPage, targetUser.email);
      const approveBtn = rowB.getByRole("button", { name: "Approve Account" });
      const rejectBtn = rowB.getByRole("button", { name: "Reject account" });

      await expect(approveBtn).toHaveAttribute("disabled");
      await expect(approveBtn).toHaveClass(/disabled/);

      await expect(rejectBtn).toHaveAttribute("disabled");
    });

    await test.step("8.5 Cleanup — release lock", async () => {
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      if (lock) {
        await releaseLockViaApi(adminAPage, ENTITY, targetUser.id, lock.token);
      }
      await expectLockNotExists(adminAPage, ENTITY, targetUser.id);
    });
  });

  // ---------------------------------------------------------------------
  // 9. Lock Re-acquisition after release
  // ---------------------------------------------------------------------

  test("Lock Re-acquisition — Admin B can acquire lock after Admin A releases", async ({
    adminAPage,
    adminBPage,
  }) => {
    await test.step("9.1 Sign in both admins and navigate", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, targetUser.email)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("9.2 Admin A acquires and releases lock", async () => {
      const result = await acquireLockViaApi(adminAPage, ENTITY, targetUser.id);
      expect(result.success).toBe(true);
      const lock = await getLockForRowViaApi(adminAPage, ENTITY, targetUser.id);
      expect(lock).not.toBeNull();
      await releaseLockViaApi(adminAPage, ENTITY, targetUser.id, lock!.token);
      await expectLockNotExists(adminAPage, ENTITY, targetUser.id);
    });

    await test.step("9.3 Admin B can now acquire lock on the same row", async () => {
      const result = await acquireLockViaApi(adminBPage, ENTITY, targetUser.id);
      expect(result.success).toBe(true);
    });

    await test.step("9.4 Admin B's lock shows Admin B's identity", async () => {
      await expectLockExists(
        adminBPage,
        ENTITY,
        targetUser.id,
        ADMIN_B.fullName,
      );
      const rowB = findTableRow(adminBPage, targetUser.email);
      await expectLockIndicatorVisible(rowB, ADMIN_B.fullName);
    });

    await test.step("9.5 Admin A sees lock with Admin B's identity", async () => {
      const rowA = findTableRow(adminAPage, targetUser.email);
      await expectLockIndicatorVisible(rowA, ADMIN_B.fullName);
    });

    await test.step("9.6 Cleanup — Admin B releases lock", async () => {
      const lock = await getLockForRowViaApi(adminBPage, ENTITY, targetUser.id);
      if (lock) {
        await releaseLockViaApi(adminBPage, ENTITY, targetUser.id, lock.token);
      }
      await expectLockNotExists(adminBPage, ENTITY, targetUser.id);
    });
  });

  // ---------------------------------------------------------------------
  // 10. Tab Close Recovery — lock auto-expires after unexpected tab close
  // ---------------------------------------------------------------------

  test("Tab Close Recovery — lock expires after admin tab closes unexpectedly", async ({
    adminAPage,
    adminBPage,
  }) => {
    test.setTimeout(180_000);

    await test.step("10.1 Sign in and acquire lock", async () => {
      await signIn(adminAPage, ADMIN_A.email, ADMIN_A.password);
      await signIn(adminBPage, ADMIN_B.email, ADMIN_B.password);
      await adminAPage.goto("/admin/account-requests");
      await adminBPage.goto("/admin/account-requests");
      await expect(findTableRow(adminAPage, ownerUser1.email)).toBeVisible({
        timeout: 15_000,
      });

      const result = await acquireLockViaApi(adminAPage, ENTITY, ownerUser1.id);
      expect(result.success).toBe(true);
    });

    await test.step("10.2 Admin B sees lock", async () => {
      const rowB = findTableRow(adminBPage, ownerUser1.email);
      await expectLockIndicatorVisible(rowB, ADMIN_A.fullName);
      await expectRowButtonsDisabled(rowB);
    });

    await test.step("10.3 Close Admin A page (simulate crash/unexpected close)", async () => {
      await adminAPage.close();
    });

    await test.step("10.4 Wait for lock TTL to expire", async () => {
      await expectLockNotExists(
        adminBPage,
        ENTITY,
        ownerUser1.id,
        TTL_POLL_TIMEOUT,
      );
    });

    await test.step("10.5 Admin B's UI updates without manual refresh", async () => {
      const rowB = findTableRow(adminBPage, ownerUser1.email);
      await expectLockIndicatorNotVisible(rowB);
      await expectRowButtonsEnabled(rowB);
    });

    await test.step("10.6 Admin B can now acquire lock", async () => {
      const result = await acquireLockViaApi(adminBPage, ENTITY, ownerUser1.id);
      expect(result.success).toBe(true);
      const lock = await getLockForRowViaApi(adminBPage, ENTITY, ownerUser1.id);
      if (lock) {
        await releaseLockViaApi(adminBPage, ENTITY, ownerUser1.id, lock.token);
      }
    });
  });
});
