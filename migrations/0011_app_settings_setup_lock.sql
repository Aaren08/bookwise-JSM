-- Migration: 0011_app_settings_setup_lock
-- Adds a BEFORE UPDATE trigger on app_settings that prevents:
--   1. Reverting setup_completed from true back to false.
--   2. Clearing initialized_at once it has been set.
--
-- Mirrors the inline pattern used by
-- 0010_setup_initialization_architecture.sql: function and trigger
-- are defined together so they are created at migration time, not
-- at application runtime.

CREATE OR REPLACE FUNCTION "prevent_setup_reinit"()
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

DROP TRIGGER IF EXISTS "app_settings_prevent_reinit" ON "app_settings";
CREATE TRIGGER "app_settings_prevent_reinit"
BEFORE UPDATE ON "app_settings"
FOR EACH ROW
EXECUTE FUNCTION "prevent_setup_reinit"();