import { NextRequest, NextResponse } from "next/server";
import { db } from "@/database/drizzle";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  requireUninitialized,
  AlreadyInitializedError,
} from "@/lib/global/auth/require-uninitialized";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    // Fast check before any work
    await requireUninitialized();

    const body = await req.json();
    const {
      fullName,
      email,
      password,
      borrowDurationDays,
      supportEmail,
      websiteUrl,
      universityName,
    } = body;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Get request metadata
    const ipAddress =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "0.0.0.0";
    const userAgent = req.headers.get("user-agent") || "unknown";
    const requestId = randomUUID();

    // Execute the setup transaction
    const result = await db.execute(sql`
      BEGIN ISOLATION LEVEL SERIALIZABLE;

      DO $$
      BEGIN
        IF NOT pg_try_advisory_xact_lock(hashtext('system_initialization')) THEN
          RAISE EXCEPTION 'setup already in progress in another session';
        END IF;
      END $$;

      WITH
      guard AS (
        SELECT initialized_at, setup_completed
        FROM app_settings
        WHERE id = true
        FOR UPDATE
      ),
      insert_owner AS (
        INSERT INTO users (
          full_name, email, password,
          status, role, ownership_type,
          ownership_assigned_at,
          session_version, version
        )
        SELECT
          ${fullName},
          ${email},
          ${hashedPassword},
          'APPROVED'::status,
          'ADMIN'::role,
          'SYSTEM_OWNER'::ownership_type,
          NOW(),
          1, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM guard WHERE initialized_at IS NOT NULL OR setup_completed = true
        )
        RETURNING id
      ),
      insert_profile AS (
        INSERT INTO user_profiles (user_id)
        SELECT id FROM insert_owner
        RETURNING user_id
      ),
      mark_initialized AS (
        UPDATE app_settings SET
          initialized_at      = NOW(),
          setup_completed     = true,
          setup_completed_at  = NOW(),
          setup_completed_by  = (SELECT id FROM insert_owner),
          borrow_duration_days = ${borrowDurationDays},
          support_email       = ${supportEmail},
          website_url         = ${websiteUrl},
          university_name     = ${universityName},
          version             = version + 1,
          updated_at          = NOW()
        WHERE id = true
          AND EXISTS (SELECT 1 FROM insert_owner)
        RETURNING id
      ),
      insert_events AS (
        INSERT INTO setup_events (event_type, actor_user_id, metadata, ip_address, user_agent)
        SELECT
          unnest(ARRAY['SETUP_STARTED', 'OWNER_CREATED', 'SETTINGS_SAVED', 'SETUP_COMPLETED']::setup_event_type[]),
          (SELECT id FROM insert_owner),
          jsonb_build_object('request_id', ${requestId}),
          ${ipAddress}::inet,
          ${userAgent}
        WHERE EXISTS (SELECT 1 FROM mark_initialized)
        RETURNING id
      ),
      insert_audit AS (
        INSERT INTO admin_audit_logs (
          actor_user_id, target_user_id, action,
          new_values, ip_address, user_agent
        )
        SELECT
          (SELECT id FROM insert_owner),
          (SELECT id FROM insert_owner),
          'ADMIN_CREATED'::admin_audit_action,
          jsonb_build_object('ownership_type', 'SYSTEM_OWNER'),
          ${ipAddress}::inet,
          ${userAgent}
        WHERE EXISTS (SELECT 1 FROM mark_initialized)
        RETURNING id
      )
      SELECT
        (SELECT id FROM insert_owner) AS owner_id,
        (SELECT user_id FROM insert_profile) AS profile_id,
        (SELECT id FROM mark_initialized) AS settings_id;

      COMMIT;
    `);

    const row = result.rows[0];
    if (!row?.owner_id) {
      throw new Error("Setup failed");
    }

    return NextResponse.json({
      success: true,
      ownerId: row.owner_id,
    });
  } catch (error) {
    if (error instanceof AlreadyInitializedError) {
      return NextResponse.json(
        { error: "System setup has already been completed" },
        { status: 409 },
      );
    }

    console.error("Setup error:", error);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
