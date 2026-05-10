CREATE TYPE "ownership_type" AS ENUM ('NONE', 'SYSTEM_OWNER');
CREATE TYPE "setup_event_type" AS ENUM (
  'SETUP_STARTED',
  'OWNER_CREATED',
  'SETTINGS_SAVED',
  'SETUP_COMPLETED',
  'SETUP_BLOCKED_ALREADY_INITIALIZED'
);
CREATE TYPE "admin_audit_action" AS ENUM (
  'ADMIN_CREATED',
  'ADMIN_UPDATED',
  'ADMIN_DEMOTED',
  'ADMIN_DELETED',
  'OWNER_PROTECTION_BLOCKED',
  'USER_STATUS_CHANGED',
  'SETTINGS_UPDATED'
);
CREATE TYPE "audit_source" AS ENUM (
  'SETUP', 'ADMIN_PANEL', 'API', 'SYSTEM', 'MIGRATION'
);

ALTER TABLE "users"
ADD COLUMN "ownership_type" "ownership_type" NOT NULL DEFAULT 'NONE';

ALTER TABLE "users"
ADD COLUMN "ownership_assigned_at" timestamp with time zone;

ALTER TABLE "users"
ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "users"
ALTER COLUMN "university_id" DROP NOT NULL;

ALTER TABLE "users"
ALTER COLUMN "university_card" DROP NOT NULL;

ALTER TABLE "books"
ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

UPDATE "users" SET "status" = 'PENDING' WHERE "status" IS NULL;
UPDATE "users" SET "role" = 'USER' WHERE "role" IS NULL;
UPDATE "users" SET "ownership_assigned_at" = "created_at" WHERE "ownership_type" = 'SYSTEM_OWNER';

ALTER TABLE "users"
ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "users"
ALTER COLUMN "role" SET NOT NULL;

ALTER TABLE "users"
ADD CONSTRAINT "users_owner_must_be_admin_chk"
CHECK ("ownership_type" = 'NONE' OR "role" = 'ADMIN');

CREATE INDEX "users_role_idx" ON "users" ("role");
CREATE INDEX "users_status_idx" ON "users" ("status");
CREATE INDEX "users_created_at_idx" ON "users" ("created_at");
CREATE UNIQUE INDEX "users_single_system_owner_idx"
ON "users" ("ownership_type")
WHERE "ownership_type" = 'SYSTEM_OWNER';
CREATE INDEX "users_created_by_idx" ON "users" ("created_by_user_id")
WHERE "created_by_user_id" IS NOT NULL;
CREATE INDEX "books_created_by_idx" ON "books" ("created_by_user_id")
WHERE "created_by_user_id" IS NOT NULL;

CREATE TABLE "user_profiles" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "university_id" varchar(30),
  "university_card" text,
  "user_avatar" text,
  "user_avatar_file_id" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "user_profiles_university_id_idx"
ON "user_profiles" ("university_id")
WHERE "university_id" IS NOT NULL;

-- Backfill ALL users (not just those with profile data),
-- so every user has a profile row from day one.
INSERT INTO "user_profiles" (
  "user_id",
  "university_id",
  "university_card",
  "user_avatar",
  "user_avatar_file_id",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "university_id",
  "university_card",
  "user_avatar",
  "user_avatar_file_id",
  COALESCE("created_at", now()),
  "updated_at"
FROM "users";

ALTER TABLE "users" DROP COLUMN "university_id";
ALTER TABLE "users" DROP COLUMN "university_card";
ALTER TABLE "users" DROP COLUMN "user_avatar";
ALTER TABLE "users" DROP COLUMN "user_avatar_file_id";

CREATE TABLE "app_settings" (
  "id" boolean PRIMARY KEY NOT NULL DEFAULT true,
  "initialized_at" timestamp with time zone,
  "borrow_duration_days" integer NOT NULL,
  "support_email" varchar(255) NOT NULL,
  "website_url" text NOT NULL,
  "university_name" varchar(255) NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "setup_completed" boolean NOT NULL DEFAULT false,
  "setup_completed_at" timestamp with time zone,
  "setup_completed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,

  CONSTRAINT "app_settings_singleton_chk"
    CHECK ("id" = true),

  CONSTRAINT "app_settings_borrow_duration_chk"
    CHECK ("borrow_duration_days" BETWEEN 1 AND 365),

  CONSTRAINT "app_settings_support_email_chk"
    CHECK ("support_email" <> ''),

  CONSTRAINT "app_settings_website_url_chk"
    CHECK ("website_url" <> ''),

  CONSTRAINT "app_settings_university_name_chk"
    CHECK ("university_name" <> '')
);

-- Backfill existing rows with "initialized_at"
UPDATE "app_settings"
SET
  "setup_completed" = true,
  "setup_completed_at" = "initialized_at"
WHERE "initialized_at" IS NOT NULL;

-- Prevent inconsistent state
ALTER TABLE "app_settings"
ADD CONSTRAINT "app_settings_no_reinit_chk"
CHECK (
  "setup_completed" = false
  OR "initialized_at" IS NOT NULL
);

CREATE TABLE "setup_events" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "event_type" "setup_event_type" NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb,
  "ip_address" inet,
  "user_agent" text,
  "request_id" uuid,
  "source" "audit_source" NOT NULL,
  "sessionId" text, 
  "correlation_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "setup_events_event_type_idx" ON "setup_events" ("event_type");
CREATE INDEX "setup_events_actor_user_id_idx" ON "setup_events" ("actor_user_id");
CREATE INDEX "setup_events_created_at_idx" ON "setup_events" ("created_at");
CREATE INDEX "setup_events_request_id_idx"
ON "setup_events" ("request_id")
WHERE "request_id" IS NOT NULL;

CREATE TABLE "admin_audit_logs" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "target_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" "admin_audit_action" NOT NULL,
  "previous_values" jsonb,
  "new_values" jsonb,
  "ip_address" inet,
  "user_agent" text,
  "request_id" uuid,
  "source" "audit_source" NOT NULL,
  "sessionId" text, 
  "correlation_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "admin_audit_logs_actor_user_id_idx" ON "admin_audit_logs" ("actor_user_id");
CREATE INDEX "admin_audit_logs_target_user_id_idx" ON "admin_audit_logs" ("target_user_id");
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs" ("action");
CREATE INDEX "admin_audit_logs_request_id_idx"
ON "admin_audit_logs" ("request_id")
WHERE "request_id" IS NOT NULL;

CREATE INDEX "admin_audit_logs_correlation_id_idx"
ON "admin_audit_logs" ("correlation_id")
WHERE "correlation_id" IS NOT NULL;
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs" ("created_at");

CREATE OR REPLACE FUNCTION "protect_system_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."ownership_type" = 'SYSTEM_OWNER' THEN
    RAISE EXCEPTION 'system owner cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."ownership_type" = 'SYSTEM_OWNER' THEN
    IF NEW."ownership_type" IS DISTINCT FROM OLD."ownership_type"
       OR NEW."role" IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'system owner cannot be demoted or ownership removed';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "users_protect_system_owner_before_update_delete"
BEFORE UPDATE OR DELETE ON "users"
FOR EACH ROW
EXECUTE FUNCTION "protect_system_owner"();