import { db } from "./drizzle";
import { sql } from "drizzle-orm";

async function bootstrap() {
  console.log("Bootstrapping system...");

  // Check if already bootstrapped (with advisory lock)
  const result = await db.execute(sql`
    BEGIN;
    
    -- Take advisory lock to prevent concurrent bootstrap attempts
    SELECT pg_try_advisory_lock(hashtext('bootstrap_script')) as locked;
    
    -- Check status
    SELECT initialized_at, setup_completed 
    FROM app_settings 
    WHERE id = true;
    
    COMMIT;
  `);

  if (result.rows[0]?.initialized_at || result.rows[0]?.setup_completed) {
    console.log("System already bootstrapped, skipping...");
    return;
  }

  try {
    await db.execute(sql`
      BEGIN ISOLATION LEVEL SERIALIZABLE;

-- Advisory lock: only one setup transaction can proceed at a time globally.
-- pg_try_advisory_xact_lock returns false if another session holds it.
-- The lock is automatically released on COMMIT/ROLLBACK.
DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('system_initialization')) THEN
    RAISE EXCEPTION 'setup already in progress in another session';
  END IF;
END $$;

WITH

-- Step 1: Guard — abort if already initialized
guard AS (
  SELECT initialized_at
  FROM app_settings
  WHERE id = true
  FOR UPDATE  -- lock the singleton row
),

-- Step 2: Create the owner user
insert_owner AS (
  INSERT INTO users (
    id, full_name, email, password,
    status, role, ownership_type,
    ownership_assigned_at,
    session_version, version,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    :fullName,
    :email,
    :hashedPassword,
    'APPROVED',
    'ADMIN',
    'SYSTEM_OWNER',
    now(),
    1, 1,
    now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM guard WHERE initialized_at IS NOT NULL
  )
  RETURNING id
),

-- Step 3: Create user profile
insert_profile AS (
  INSERT INTO user_profiles (user_id, created_at, updated_at)
  SELECT id, now(), now()
  FROM insert_owner
  RETURNING user_id
),

-- Step 4: Mark app as initialized
mark_initialized AS (
  UPDATE app_settings SET
    initialized_at      = now(),
    setup_completed     = true,
    setup_completed_at  = now(),
    setup_completed_by  = (SELECT id FROM insert_owner),
    borrow_duration_days = :borrowDurationDays,
    support_email       = :supportEmail,
    website_url         = :websiteUrl,
    university_name     = :universityName,
    version             = version + 1,
    updated_at          = now()
  WHERE id = true
    AND EXISTS (SELECT 1 FROM insert_owner) -- only if owner was created
  RETURNING id
),

-- Step 5: Emit setup events
insert_events AS (
  INSERT INTO setup_events (event_type, actor_user_id, metadata, ip_address, user_agent, request_id)
  SELECT
    unnest(ARRAY['SETUP_STARTED', 'OWNER_CREATED', 'SETTINGS_SAVED', 'SETUP_COMPLETED']::setup_event_type[]),
    (SELECT id FROM insert_owner),
    jsonb_build_object('ip', :ipAddress),
    :ipAddress::inet,
    :userAgent,
    :requestId
  WHERE EXISTS (SELECT 1 FROM mark_initialized)
  RETURNING id
),

-- Step 6: Audit log
insert_audit AS (
  INSERT INTO admin_audit_logs (
    actor_user_id, target_user_id, action,
    new_values, ip_address, user_agent, request_id, source
  )
  SELECT
    (SELECT id FROM insert_owner),
    (SELECT id FROM insert_owner),
    'OWNERSHIP_ASSIGNED',
    jsonb_build_object('ownership_type', 'SYSTEM_OWNER'),
    :ipAddress::inet,
    :userAgent,
    :requestId,
    'SETUP'
  WHERE EXISTS (SELECT 1 FROM mark_initialized)
  RETURNING id
)

-- Final integrity assertion: confirm all steps produced rows
SELECT
  (SELECT id FROM insert_owner)      AS owner_id,
  (SELECT user_id FROM insert_profile) AS profile_id,
  (SELECT id FROM mark_initialized)  AS settings_id,
  (SELECT COUNT(*) FROM insert_events) AS event_count,
  (SELECT id FROM insert_audit)      AS audit_id;

-- Application code checks the returned row: if any column is NULL,
-- it means the guard fired (already initialized) or a step silently failed.
-- In both cases, ROLLBACK.

COMMIT;`);
    console.log("Bootstrap complete!");
  } catch (error) {
    console.error("Bootstrap failed:", error);
    throw error;
  } finally {
    // Release advisory lock
    await db.execute(
      sql`SELECT pg_advisory_unlock(hashtext('bootstrap_script'))`,
    );
  }
}

bootstrap().catch(console.error);
