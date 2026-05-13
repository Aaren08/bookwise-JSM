import { NextRequest, NextResponse } from "next/server";
import { db } from "@/database/drizzle";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z, flattenError } from "zod";
import {
  requireUninitialized,
  AlreadyInitializedError,
} from "@/lib/global/auth/require-uninitialized";
import { randomUUID } from "crypto";
import { refreshSetupStateCache } from "@/lib/global/setup-state";

const setupBodySchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  email: z.email().max(255),
  password: z.string().min(8).max(256),
  userAvatar: z.url().optional().nullable(),
  userAvatarFileId: z.string().optional().nullable(),
  borrowDurationDays: z.number().int().min(1).max(365),
  supportEmail: z.email().max(255),
  websiteUrl: z.url(),
  universityName: z.string().trim().min(1).max(255),
});

export async function POST(req: NextRequest) {
  try {
    // Fast check before any work
    await requireUninitialized();

    const parsed = setupBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid setup payload", issues: flattenError(parsed.error) },
        { status: 400 },
      );
    }

    const {
      fullName,
      email,
      password,
      userAvatar,
      userAvatarFileId,
      borrowDurationDays,
      supportEmail,
      websiteUrl,
      universityName,
    } = parsed.data;

    const hashedPassword = await bcrypt.hash(password, 12);

    const forwardedFor = req.headers.get("x-forwarded-for");
    const ipAddress =
      forwardedFor?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "0.0.0.0";
    const userAgent = req.headers.get("user-agent") || "unknown";
    const requestId = randomUUID();

    const result = await db.transaction(
      async (tx) => {
        // Advisory lock: only one setup transaction proceeds at a time globally.
        await tx.execute(sql`
          DO $$
          BEGIN
            IF NOT pg_try_advisory_xact_lock(hashtext('system_initialization')) THEN
              RAISE EXCEPTION 'setup already in progress in another session';
            END IF;
          END $$
        `);

        // Single CTE: all DML in one round-trip, fully atomic.
        // insert_profile is removed — profile columns now live on users directly.
        const rows = await tx.execute(sql`
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
              status, role,
              user_avatar, user_avatar_file_id,
              session_version, version
            )
            SELECT
              ${fullName},
              ${email},
              ${hashedPassword},
              'APPROVED'::status,
              'ADMIN'::role,
              ${userAvatar ?? null},
              ${userAvatarFileId ?? null},
              1, 1
            WHERE NOT EXISTS (
              SELECT 1 FROM guard
              WHERE initialized_at IS NOT NULL OR setup_completed = true
            )
            RETURNING id
          ),
          mark_initialized AS (
            UPDATE app_settings SET
              initialized_at       = NOW(),
              setup_completed      = true,
              setup_completed_at   = NOW(),
              setup_completed_by   = (SELECT id FROM insert_owner),
              borrow_duration_days = ${borrowDurationDays},
              support_email        = ${supportEmail},
              website_url          = ${websiteUrl},
              university_name      = ${universityName},
              version              = version + 1,
              updated_at           = NOW()
            WHERE id = true
              AND EXISTS (SELECT 1 FROM insert_owner)
            RETURNING id
          ),
          insert_events AS (
            INSERT INTO setup_events (event_type, actor_user_id, metadata, ip_address, user_agent)
            SELECT
              unnest(ARRAY[
                'SETUP_STARTED',
                'OWNER_CREATED',
                'SETTINGS_SAVED',
                'SETUP_COMPLETED'
              ]::setup_event_type[]),
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
              jsonb_build_object('role', 'ADMIN', 'via', 'setup'),
              ${ipAddress}::inet,
              ${userAgent}
            WHERE EXISTS (SELECT 1 FROM mark_initialized)
            RETURNING id
          )
          SELECT
            (SELECT id FROM insert_owner)     AS owner_id,
            (SELECT id FROM mark_initialized) AS settings_id
        `);

        const row = rows.rows[0];

        // If either ID is null the guard fired (already initialized) or a
        // step silently failed. Throwing here causes Drizzle to ROLLBACK.
        if (!row?.owner_id || !row?.settings_id) {
          throw new Error("Setup failed: system may already be initialized");
        }

        return row;
      },
      { isolationLevel: "serializable" },
    );

    await refreshSetupStateCache();

    return NextResponse.json({
      success: true,
      ownerId: result.owner_id,
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
