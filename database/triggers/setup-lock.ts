import { db } from "../drizzle";
import { sql } from "drizzle-orm";

async function setupTrigger() {
  await db.execute(sql`CREATE OR REPLACE FUNCTION "prevent_setup_reinit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Once setup_completed = true, it cannot be set back to false
  IF OLD."setup_completed" = true AND NEW."setup_completed" = false THEN
    RAISE EXCEPTION 'setup cannot be undone once completed';
  END IF;

  -- initialized_at cannot be cleared after being set
  IF OLD."initialized_at" IS NOT NULL AND NEW."initialized_at" IS NULL THEN
    RAISE EXCEPTION 'initialized_at cannot be cleared';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "app_settings_prevent_reinit"
BEFORE UPDATE ON "app_settings"
FOR EACH ROW
EXECUTE FUNCTION "prevent_setup_reinit"();`);
}

setupTrigger().catch(console.error);
