import { db } from "@/database/drizzle";
import { sql } from "drizzle-orm";

export class AlreadyInitializedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyInitializedError";
  }
}

export async function requireUninitialized(): Promise<void> {
  const result = await db.execute(sql`
    SELECT initialized_at, setup_completed 
    FROM app_settings 
    WHERE id = true
  `);

  const row = result[0];
  if (!row) return; // No singleton row yet → not initialized

  const isInitialized =
    row.initialized_at != null || row.setup_completed === true;

  if (isInitialized) {
    throw new AlreadyInitializedError(
      "System setup has already been completed",
    );
  }
}
