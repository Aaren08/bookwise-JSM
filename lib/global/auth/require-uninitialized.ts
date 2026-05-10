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

  const isInitialized =
    result.rows[0]?.initialized_at !== null ||
    result.rows[0]?.setup_completed === true;

  if (isInitialized) {
    throw new AlreadyInitializedError(
      "System setup has already been completed",
    );
  }
}
