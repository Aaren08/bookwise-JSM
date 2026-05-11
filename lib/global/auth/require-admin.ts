import { db } from "@/database/drizzle";
import { users } from "@/database/schema";
import { eq } from "drizzle-orm";

// ─── Error classes ────────────────────────────────────────────────────────────

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class StaleSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleSessionError";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Session {
  userId: string;
  sessionVersion: number;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Re-fetches the user from the DB and asserts:
 *   1. The user exists and is ADMIN.
 *   2. Their sessionVersion matches the token claim (session not invalidated).
 *   3. Their account is APPROVED.
 *
 * Never trust session token claims alone for privilege checks — always
 * re-query. The sessionVersion check makes forced sign-outs take effect
 * immediately without a token blocklist.
 */
export async function requireAdmin(session: Session): Promise<void> {
  const [user] = await db
    .select({
      role: users.role,
      sessionVersion: users.sessionVersion,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, session.userId));

  if (!user || user.role !== "ADMIN") {
    throw new UnauthorizedError("Admin access required");
  }

  if (user.sessionVersion !== session.sessionVersion) {
    throw new StaleSessionError("Session invalidated");
  }

  if (user.status !== "APPROVED") {
    throw new UnauthorizedError("Account suspended");
  }
}
