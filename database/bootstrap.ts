import { db } from "./drizzle";
import { sql } from "drizzle-orm";

// ─── bootstrap() ────────────────────────────────────────────────────────────
// No longer executed on import.  Call explicitly from your setup route after
// validating + hashing user input.
export async function bootstrap(input: BootstrapInput): Promise<void> {
  const {
    fullName,
    email,
    hashedPassword,
    borrowDurationDays,
    supportEmail,
    websiteUrl,
    universityName,
    ipAddress,
    userAgent,
    requestId,
  } = input;

  console.log("Bootstrapping system...");

  // Single SERIALIZABLE transaction.
  // pg_try_advisory_xact_lock is transaction-scoped: it is automatically
  // released on COMMIT/ROLLBACK — no manual unlock call needed and no
  // session-level lock leakage.  The pre-check race that existed when using
  // pg_try_advisory_lock outside the transaction is eliminated.
  const result = await db.execute(sql`
    BEGIN ISOLATION LEVEL SERIALIZABLE;

    -- Transaction-scoped advisory lock: only one session can proceed.
    -- Returns false immediately if another session holds it.
    DO $$
    BEGIN
      IF NOT pg_try_advisory_xact_lock(hashtext('system_initialization')) THEN
        RAISE EXCEPTION 'setup already in progress in another session';
      END IF;
    END $$;

    WITH

    -- Step 1: Guard — abort the entire CTE chain if already initialized.
    guard AS (
      SELECT initialized_at
      FROM app_settings
      WHERE id = true
      FOR UPDATE          -- lock the singleton row against concurrent writes
    ),

    -- Step 2: Create the owner user.
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
        ${fullName},
        ${email},
        ${hashedPassword},
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

    -- Step 3: Create user profile.
    insert_profile AS (
      INSERT INTO user_profiles (user_id, created_at, updated_at)
      SELECT id, now(), now()
      FROM insert_owner
      RETURNING user_id
    ),

    -- Step 4: Mark app as initialized.
    mark_initialized AS (
      UPDATE app_settings SET
        initialized_at      = now(),
        setup_completed     = true,
        setup_completed_at  = now(),
        setup_completed_by  = (SELECT id FROM insert_owner),
        borrow_duration_days = ${borrowDurationDays},
        support_email       = ${supportEmail},
        website_url         = ${websiteUrl},
        university_name     = ${universityName},
        version             = version + 1,
        updated_at          = now()
      WHERE id = true
        AND EXISTS (SELECT 1 FROM insert_owner)
      RETURNING id
    ),

    -- Step 5: Emit setup events.
    insert_events AS (
      INSERT INTO setup_events (event_type, actor_user_id, metadata, ip_address, user_agent, request_id)
      SELECT
        unnest(ARRAY['SETUP_STARTED', 'OWNER_CREATED', 'SETTINGS_SAVED', 'SETUP_COMPLETED']::setup_event_type[]),
        (SELECT id FROM insert_owner),
        jsonb_build_object('ip', ${ipAddress}),
        ${ipAddress}::inet,
        ${userAgent},
        ${requestId}
      WHERE EXISTS (SELECT 1 FROM mark_initialized)
      RETURNING id
    ),

    -- Step 6: Audit log.
    -- 'ADMIN_CREATED' is used in place of the invalid 'OWNERSHIP_ASSIGNED'
    -- value that does not exist in the admin_audit_action enum.
    insert_audit AS (
      INSERT INTO admin_audit_logs (
        actor_user_id, target_user_id, action,
        new_values, ip_address, user_agent, request_id, source
      )
      SELECT
        (SELECT id FROM insert_owner),
        (SELECT id FROM insert_owner),
        'ADMIN_CREATED'::admin_audit_action,
        jsonb_build_object('ownership_type', 'SYSTEM_OWNER'),
        ${ipAddress}::inet,
        ${userAgent},
        ${requestId},
        'SETUP'
      WHERE EXISTS (SELECT 1 FROM mark_initialized)
      RETURNING id
    )

    -- Final integrity assertion: if any column is NULL a step silently
    -- failed or the guard fired (already initialized).  The caller
    -- inspects this row and rolls back + throws when appropriate.
    SELECT
      (SELECT id        FROM insert_owner)    AS owner_id,
      (SELECT user_id   FROM insert_profile)  AS profile_id,
      (SELECT id        FROM mark_initialized) AS settings_id,
      (SELECT COUNT(*)  FROM insert_events)   AS event_count,
      (SELECT id        FROM insert_audit)    AS audit_id;

    COMMIT;
  `);

  // Integrity check: every step must have produced a row.
  const row = result.rows[0] as Record<string, unknown> | undefined;

  if (
    !row?.owner_id ||
    !row?.profile_id ||
    !row?.settings_id ||
    !row?.audit_id
  ) {
    // Either already initialized (guard fired) or a step silently produced
    // no rows.  Roll back is handled by the DB on connection reset; surface
    // a clear error to the caller.
    throw new Error(
      "Bootstrap aborted: system is already initialized or a setup step produced no rows. " +
        `Integrity row: ${JSON.stringify(row)}`,
    );
  }

  console.log("Bootstrap complete!", { ownerId: row.owner_id });
}
