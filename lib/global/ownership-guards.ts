import { users, adminAuditLogs } from "@/database/schema";
import { eq } from "drizzle-orm";

// Infer the transaction type from your database instance
type Database = typeof import("@/database/drizzle").db; // Your db instance type
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class OwnershipTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnershipTransferError";
  }
}

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

// Reusable guard: call inside any transaction that touches a user row
export async function assertNotSystemOwner(
  tx: Transaction,
  userId: string,
  operation: string,
): Promise<void> {
  const [user] = await tx
    .select({ ownershipType: users.ownershipType })
    .from(users)
    .where(eq(users.id, userId))
    .for("update"); // lock the row — this IS the check and lock

  if (!user) throw new Error(`User ${userId} not found`);

  if (user.ownershipType === "SYSTEM_OWNER") {
    // Log the blocked attempt
    await tx.insert(adminAuditLogs).values({
      targetUserId: userId,
      action: "OWNER_PROTECTION_BLOCKED",
      newValues: { attempted_operation: operation },
    });
    throw new PrivilegeEscalationError(
      `Operation '${operation}' is not permitted on the system owner`,
    );
  }
}

// Validate the acting session is not stale
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
      "Your session has been invalidated. Please log in again.",
    );
  }
}

// Optimistic concurrency check for any versioned entity
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
