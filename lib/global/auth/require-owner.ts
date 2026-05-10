import { db } from "@/database/drizzle";
import { users } from "@/database/schema";
import { eq } from "drizzle-orm";

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

export interface Session {
  userId: string;
  sessionVersion: number;
}

export async function requireOwner(session: Session): Promise<void> {
  // Re-fetch from DB, never trust session claims for ownership checks
  const [user] = await db
    .select({
      ownershipType: users.ownershipType,
      sessionVersion: users.sessionVersion,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, session.userId));

  if (!user || user.ownershipType !== "SYSTEM_OWNER") {
    throw new UnauthorizedError("Owner access required");
  }

  if (user.sessionVersion !== session.sessionVersion) {
    throw new StaleSessionError("Session invalidated");
  }

  if (user.status !== "APPROVED") {
    throw new UnauthorizedError("Account suspended");
  }
}
