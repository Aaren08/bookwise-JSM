import { users, adminAuditLogs } from "@/database/schema";
import { eq } from "drizzle-orm";

type Database = typeof import("@/database/drizzle").db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Error classes

export class PrivilegeEscalationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivilegeEscalationError";
  }
}

export class StaleSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleSessionError";
  }
}

export class OptimisticLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptimisticLockError";
  }
}

// Guards

/**
 * Prevents any privileged operation from being applied to an ADMIN user
 * without an explicit acknowledgment. Call this inside any transaction
 * that demotes, deletes, or status-changes a user, to get a clean service
 * error before the DB has a chance to surface a cryptic constraint violation.
 *
 * The `.for("update")` lock means the check and the subsequent DML share
 * the same row lock — no TOCTOU gap.
 */
export async function assertNotAdmin(
  tx: Transaction,
  userId: string,
  operation: string,
): Promise<void> {
  const [user] = await tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");

  if (!user) throw new Error(`User ${userId} not found`);

  if (user.role === "ADMIN") {
    // Log the blocked attempt outside the caller's transaction so the audit
    // row survives even if the outer tx rolls back.
    const { db } = await import("@/database/drizzle");
    await db.insert(adminAuditLogs).values({
      targetUserId: userId,
      action: "USER_STATUS_CHANGED", // closest available action
      newValues: { attempted_operation: operation, blocked: true },
    });

    throw new PrivilegeEscalationError(
      `Operation '${operation}' is not permitted on an admin user`,
    );
  }
}

/**
 * Validates the acting session version against the live DB row.
 * Throws StaleSessionError when they diverge, which means the user's
 * session was invalidated (e.g. password reset, forced sign-out).
 */
export async function assertSessionFresh(
  tx: Transaction,
  userId: string,
  claimedSessionVersion: number,
): Promise<void> {
  const [user] = await tx
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) throw new Error("Actor not found");

  if (user.sessionVersion !== claimedSessionVersion) {
    throw new StaleSessionError(
      "Your session has been invalidated. Please sign in again.",
    );
  }
}

/**
 * Optimistic concurrency check for any versioned entity.
 * Call before any update; throw before touching the DB if version mismatches.
 */
export function assertVersion<T extends { version: number }>(
  entity: T,
  expectedVersion: number,
  entityName: string,
): void {
  if (entity.version !== expectedVersion) {
    throw new OptimisticLockError(
      `${entityName} was modified by another request. Please retry.`,
    );
  }
}
