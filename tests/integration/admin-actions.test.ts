/**
 * admin-actions.test.ts — Integration tests for admin user management actions.
 *
 * Covers:
 * - approveAccount: version-locked approval, lock ownership, realtime events
 * - rejectAccount: version-locked rejection, lock ownership, realtime events
 * - deleteUser: active-borrow guard, transactional delete, version check
 * - updateUserRole: role changes, session invalidation, admin-remain constraint
 *
 * Mocked: @/auth, @/database/redis, broadcast modules
 * NOT mocked: Drizzle query chain, business logic, version checks, lock logic
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  mockAuth,
  mockDb,
  mockRedisGet,
  mockRedisEval,
  mockBroadcastAdminDashboard,
  mockPublishEvent,
  mockPublishRoleChangeEvent,
} from "./helpers/instances";
import {
  createApprovedUser,
  createPendingUser,
  createRejectedUser,
  createBorrowedBorrow,
  createLateReturnBorrow,
  createReturnedBorrow,
  createAppSettings,
} from "./helpers/fixtures";
import {
  assertRowExists,
  assertRowNotExists,
  assertUserStatus,
  assertUserRole,
  assertVersionIncremented,
} from "./helpers/assertions";

// ─── Module under test ────────────────────────────────────────────────────

let approveAccount: typeof import("@/lib/admin/actions/user").approveAccount;
let rejectAccount: typeof import("@/lib/admin/actions/user").rejectAccount;
let deleteUser: typeof import("@/lib/admin/actions/user").deleteUser;
let updateUserRole: typeof import("@/lib/admin/actions/user").updateUserRole;

// ─── Helpers ───────────────────────────────────────────────────────────────

const ADMIN_ID = "admin-user-id";
const LOCK_TOKEN = "test-lock-token";

function setupLockInRedis() {
  const lockPayload = JSON.stringify({
    adminId: ADMIN_ID,
    adminName: "Admin",
    token: LOCK_TOKEN,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    version: 1,
  });
  mockRedisGet.mockResolvedValue(lockPayload);
}

function setupAdminSession() {
  mockAuth.mockResolvedValue({
    user: {
      id: ADMIN_ID,
      name: "Admin User",
      email: "admin@test.edu",
      role: "ADMIN",
      sessionVersion: 1,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  });
}

// ─── Setup ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  mockDb.clear();
  mockDb.seed("app_settings", [createAppSettings()]);

  setupAdminSession();
  setupLockInRedis();
  mockRedisEval.mockResolvedValue(["OK", "released"]);

  mockBroadcastAdminDashboard.mockClear();
  mockPublishEvent.mockClear();
  mockPublishRoleChangeEvent.mockClear();

  const userModule = await import("@/lib/admin/actions/user");
  approveAccount = userModule.approveAccount;
  rejectAccount = userModule.rejectAccount;
  deleteUser = userModule.deleteUser;
  updateUserRole = userModule.updateUserRole;
});

// ═══════════════════════════════════════════════════════════════════════════
// approveAccount
// ═══════════════════════════════════════════════════════════════════════════

describe("approveAccount", () => {
  it("approves a PENDING user and changes status to APPROVED", async () => {
    const user = createPendingUser({ id: "pending-user-id" });
    mockDb.seed("users", [user]);

    const result = await approveAccount({
      userId: "pending-user-id",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("Account approved successfully");
    assertUserStatus("pending-user-id", "APPROVED");
    assertVersionIncremented("users", "pending-user-id", 1);
  });

  it("returns error when user is already APPROVED", async () => {
    const user = createApprovedUser({ id: "approved-user", version: 2 });
    mockDb.seed("users", [user]);

    const result = await approveAccount({
      userId: "approved-user",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Account request no longer pending");
    // Status should remain APPROVED
    assertUserStatus("approved-user", "APPROVED");
  });

  it("returns error when user is REJECTED", async () => {
    const user = createRejectedUser({ id: "rejected-user", version: 2 });
    mockDb.seed("users", [user]);

    const result = await approveAccount({
      userId: "rejected-user",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Account request no longer pending");
  });

  it("returns conflict error on version mismatch", async () => {
    const user = createPendingUser({ id: "pending-user", version: 3 });
    mockDb.seed("users", [user]);

    const result = await approveAccount({
      userId: "pending-user",
      expectedVersion: 2, // Wrong version
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("newer changes");
    assertUserStatus("pending-user", "PENDING");
  });

  it("throws Forbidden when not an admin", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "regular-user",
        name: "User",
        email: "user@test.edu",
        role: "USER",
      },
      expires: new Date().toISOString(),
    });

    const result = await approveAccount({
      userId: "any-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Forbidden");
  });

  it("fails when lock is held by another admin", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        adminId: "other-admin",
        adminName: "Other Admin",
        token: "other-token",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        version: 1,
      }),
    );

    const user = createPendingUser({ id: "pending-user" });
    mockDb.seed("users", [user]);

    const result = await approveAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("being edited by");
  });

  it("fails when lock token does not match", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        adminId: ADMIN_ID,
        adminName: "Admin",
        token: "different-token",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        version: 1,
      }),
    );

    const user = createPendingUser({ id: "pending-user" });
    mockDb.seed("users", [user]);

    const result = await approveAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
  });

  it("fails when lock is expired (no lock in Redis)", async () => {
    mockRedisGet.mockResolvedValueOnce(null);

    const user = createPendingUser({ id: "pending-user" });
    mockDb.seed("users", [user]);

    const result = await approveAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
  });

  it("publishes realtime events after approval", async () => {
    const user = createPendingUser({ id: "pending-user" });
    mockDb.seed("users", [user]);

    await approveAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    // Should publish DELETE for account_requests
    expect(mockPublishEvent).toHaveBeenCalledWith(
      "account_requests",
      expect.objectContaining({
        type: "DELETE",
        entityId: "pending-user",
      }),
    );

    // Should publish CREATE for users
    expect(mockPublishEvent).toHaveBeenCalledWith(
      "users",
      expect.objectContaining({
        type: "CREATE",
        entityId: "pending-user",
      }),
    );
  });

  it("broadcasts admin dashboard update after approval", async () => {
    const user = createPendingUser({ id: "pending-user" });
    mockDb.seed("users", [user]);

    await approveAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockBroadcastAdminDashboard).toHaveBeenCalledTimes(1);
  });

  it("releases lock in finally block on success", async () => {
    const user = createPendingUser({ id: "pending-user" });
    mockDb.seed("users", [user]);

    mockRedisEval.mockClear();

    await approveAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    // releaseLock was called (redis.eval for RELEASE_SCRIPT)
    expect(mockRedisEval).toHaveBeenCalled();
  });

  it("releases lock even when approval fails", async () => {
    const user = createPendingUser({ id: "pending-user", version: 5 });
    mockDb.seed("users", [user]);

    mockRedisEval.mockClear();

    await approveAccount({
      userId: "pending-user",
      expectedVersion: 99, // Will cause conflict
      lockToken: LOCK_TOKEN,
    });

    // Lock should still be released despite failure
    expect(mockRedisEval).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rejectAccount
// ═══════════════════════════════════════════════════════════════════════════

describe("rejectAccount", () => {
  it("rejects a PENDING user and changes status to REJECTED", async () => {
    const user = createPendingUser({ id: "reject-user-id" });
    mockDb.seed("users", [user]);

    const result = await rejectAccount({
      userId: "reject-user-id",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("Account rejected successfully");
    assertUserStatus("reject-user-id", "REJECTED");
    assertVersionIncremented("users", "reject-user-id", 1);
  });

  it("returns error when user is already approved", async () => {
    const user = createApprovedUser({ id: "already-approved", version: 2 });
    mockDb.seed("users", [user]);

    const result = await rejectAccount({
      userId: "already-approved",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Account request no longer pending");
  });

  it("returns conflict error on version mismatch", async () => {
    const user = createPendingUser({ id: "pending-user", version: 2 });
    mockDb.seed("users", [user]);

    const result = await rejectAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    assertUserStatus("pending-user", "PENDING");
  });

  it("publishes DELETE event for account_requests on reject", async () => {
    const user = createPendingUser({ id: "pending-user" });
    mockDb.seed("users", [user]);

    await rejectAccount({
      userId: "pending-user",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "account_requests",
      expect.objectContaining({
        type: "DELETE",
        entityId: "pending-user",
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteUser
// ═══════════════════════════════════════════════════════════════════════════

describe("deleteUser", () => {
  const userId = "user-to-delete";

  it("deletes a user with no active borrows", async () => {
    const user = createApprovedUser({ id: userId, version: 2 });
    mockDb.seed("users", [user]);
    // Some returned records (not active)
    mockDb.seed("borrow_records", [
      createReturnedBorrow({ userId, bookId: "book-1" }),
    ]);

    const result = await deleteUser({
      userId,
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    // User should be removed
    assertRowNotExists("users", userId);
    // Borrow records for user should be deleted
    expect(mockDb.getTable("borrow_records").length).toBe(0);
  });

  it("prevents deletion when user has active BORROWED records", async () => {
    const user = createApprovedUser({ id: userId });
    mockDb.seed("users", [user]);
    mockDb.seed("borrow_records", [
      createBorrowedBorrow({ userId, bookId: "book-1" }),
    ]);

    const result = await deleteUser({
      userId,
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("active borrow");
    // User should still exist
    assertRowExists("users", userId);
    // Borrow records should still exist
    expect(mockDb.getTable("borrow_records").length).toBe(1);
  });

  it("prevents deletion when user has LATE_RETURN records", async () => {
    const user = createApprovedUser({ id: userId });
    mockDb.seed("users", [user]);
    mockDb.seed("borrow_records", [
      createLateReturnBorrow({ userId, bookId: "book-1" }),
    ]);

    const result = await deleteUser({
      userId,
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("active borrow");
  });

  it("allows deletion when user has RETURNED or REJECTED records only", async () => {
    const user = createApprovedUser({ id: userId });
    mockDb.seed("users", [user]);
    mockDb.seed("borrow_records", [
      createReturnedBorrow({ userId, bookId: "book-1" }),
      {
        id: "rejected-record",
        userId,
        bookId: "book-2",
        borrowStatus: "REJECTED",
        dueDate: new Date().toISOString().slice(0, 10),
        version: 1,
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const result = await deleteUser({
      userId,
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    assertRowNotExists("users", userId);
  });

  it("returns conflict error on version mismatch in delete", async () => {
    const user = createApprovedUser({ id: userId, version: 3 });
    mockDb.seed("users", [user]);

    const result = await deleteUser({
      userId,
      expectedVersion: 2, // Wrong version
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("newer changes");
    assertRowExists("users", userId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateUserRole
// ═══════════════════════════════════════════════════════════════════════════

describe("updateUserRole", () => {
  it("upgrades USER to ADMIN successfully", async () => {
    const user = createApprovedUser({
      id: "user-to-upgrade",
      role: "USER",
      sessionVersion: 1,
      version: 2,
    });
    mockDb.seed("users", [user]);

    const result = await updateUserRole({
      userId: "user-to-upgrade",
      role: "ADMIN",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    assertUserRole("user-to-upgrade", "ADMIN");
    // Version bumped
    assertVersionIncremented("users", "user-to-upgrade", 2);
    // Session version should NOT change on upgrade
    const updated = assertRowExists("users", "user-to-upgrade");
    expect(updated.sessionVersion).toBe(1);
  });

  it("downgrades ADMIN to USER and bumps sessionVersion", async () => {
    // Need at least 2 admins for the at-least-one-admin check
    const targetUser = createApprovedUser({
      id: "admin-to-downgrade",
      role: "ADMIN",
      sessionVersion: 1,
      version: 3,
    });
    const otherAdmin = createApprovedUser({
      id: "other-admin",
      role: "ADMIN",
      sessionVersion: 1,
      version: 1,
    });
    mockDb.seed("users", [targetUser, otherAdmin]);

    const result = await updateUserRole({
      userId: "admin-to-downgrade",
      role: "USER",
      expectedVersion: 3,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    assertUserRole("admin-to-downgrade", "USER");
    // Session version should be bumped on downgrade (ADMIN → USER)
    const updated = assertRowExists("users", "admin-to-downgrade");
    expect(updated.sessionVersion).toBe(2);
    assertVersionIncremented("users", "admin-to-downgrade", 3);
  });

  it("fires role-change event on ADMIN → USER downgrade", async () => {
    const targetUser = createApprovedUser({
      id: "admin-to-downgrade-2",
      role: "ADMIN",
      sessionVersion: 1,
      version: 2,
    });
    const otherAdmin = createApprovedUser({
      id: "other-admin-2",
      role: "ADMIN",
      version: 1,
    });
    mockDb.seed("users", [targetUser, otherAdmin]);

    await updateUserRole({
      userId: "admin-to-downgrade-2",
      role: "USER",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(mockPublishRoleChangeEvent).toHaveBeenCalledWith({
      userId: "admin-to-downgrade-2",
      newRole: "USER",
      sessionVersion: 2,
    });
  });

  it("does NOT fire role-change event on USER → ADMIN upgrade", async () => {
    const user = createApprovedUser({
      id: "user-to-upgrade-2",
      role: "USER",
      sessionVersion: 1,
      version: 1,
    });
    mockDb.seed("users", [user]);

    await updateUserRole({
      userId: "user-to-upgrade-2",
      role: "ADMIN",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockPublishRoleChangeEvent).not.toHaveBeenCalled();
  });

  it("prevents downgrading the last ADMIN", async () => {
    // Only one admin exists
    const onlyAdmin = createApprovedUser({
      id: "last-admin",
      role: "ADMIN",
      sessionVersion: 1,
      version: 1,
    });
    mockDb.seed("users", [onlyAdmin]);

    const result = await updateUserRole({
      userId: "last-admin",
      role: "USER",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("At least one administrator is required");
    assertUserRole("last-admin", "ADMIN");
  });

  it("prevents downgrading when other admins exist but version conflict", async () => {
    const targetUser = createApprovedUser({
      id: "admin-conflict",
      role: "ADMIN",
      sessionVersion: 1,
      version: 5,
    });
    const otherAdmin = createApprovedUser({
      id: "other-admin-3",
      role: "ADMIN",
      version: 1,
    });
    mockDb.seed("users", [targetUser, otherAdmin]);

    const result = await updateUserRole({
      userId: "admin-conflict",
      role: "USER",
      expectedVersion: 4, // Wrong version
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("At least one administrator is required");
    assertUserRole("admin-conflict", "ADMIN");
  });

  it("publishes users UPDATE event after role change", async () => {
    const user = createApprovedUser({
      id: "user-role-event",
      role: "USER",
      version: 1,
    });
    mockDb.seed("users", [user]);

    await updateUserRole({
      userId: "user-role-event",
      role: "ADMIN",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "users",
      expect.objectContaining({
        type: "UPDATE",
        entityId: "user-role-event",
      }),
    );
  });

  it("broadcasts admin dashboard update after role change", async () => {
    const user = createApprovedUser({
      id: "user-dash-event",
      role: "USER",
      version: 1,
    });
    mockDb.seed("users", [user]);

    await updateUserRole({
      userId: "user-dash-event",
      role: "ADMIN",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockBroadcastAdminDashboard).toHaveBeenCalled();
  });

  it("releases lock in finally block on success", async () => {
    mockRedisEval.mockClear();
    const user = createApprovedUser({
      id: "user-lock-release",
      role: "USER",
      version: 1,
    });
    mockDb.seed("users", [user]);

    await updateUserRole({
      userId: "user-lock-release",
      role: "ADMIN",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockRedisEval).toHaveBeenCalled();
  });

  it("releases lock in finally block even on failure", async () => {
    mockRedisEval.mockClear();
    const user = createApprovedUser({
      id: "user-lock-fail",
      role: "ADMIN",
      version: 1,
    });
    mockDb.seed("users", [user]);

    // This will fail because we're trying to downgrade the only admin
    await updateUserRole({
      userId: "user-lock-fail",
      role: "USER",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockRedisEval).toHaveBeenCalled();
  });
});
