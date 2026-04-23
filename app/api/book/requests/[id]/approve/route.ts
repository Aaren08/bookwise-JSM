/**
 * PATCH /api/requests/:id/approve
 *
 * Transitions a PENDING request to BORROWED.
 * Uses a single SQL statement so the record update and counter swap stay atomic
 * on the Neon HTTP driver, which does not support db.transaction().
 */
export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/dashboardSocketServer";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

type ApproveRow = {
  request_id: string;
  book_id: string;
  user_id: string;
  available_copies: number | null;
  reserved_count: number | null;
  borrowed_count: number | null;
};

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: recordId } = await params;

    const result = await db.execute(sql`
      WITH updated_record AS (
        UPDATE borrow_records
        SET borrow_status = 'BORROWED'::borrow_status
        WHERE id = ${recordId}
          AND borrow_status = 'PENDING'::borrow_status
        RETURNING id, book_id, user_id
      ),
      updated_book AS (
        UPDATE books
        SET
          reserved_count = GREATEST(0, reserved_count - 1),
          borrowed_count = borrowed_count + 1
        WHERE id = (SELECT book_id FROM updated_record)
        RETURNING id, available_copies, reserved_count, borrowed_count
      )
      SELECT
        ur.id AS request_id,
        ur.book_id,
        ur.user_id,
        ub.available_copies,
        ub.reserved_count,
        ub.borrowed_count
      FROM updated_record ur
      LEFT JOIN updated_book ub ON TRUE;
    `);

    const row = (result.rows[0] as ApproveRow | undefined) ?? null;

    if (!row) {
      return NextResponse.json(
        { error: "Request not found or no longer pending." },
        { status: 409 },
      );
    }

    revalidatePath("/admin/borrow-records");
    revalidatePath("/my-profile");
    revalidatePath(`/admin/books/${row.book_id}`);
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    if (
      row.available_copies !== null &&
      row.reserved_count !== null &&
      row.borrowed_count !== null
    ) {
      broadcastBookAvailabilityUpdate(
        row.book_id,
        row.available_copies,
        row.reserved_count,
        row.borrowed_count,
      ).catch((err) =>
        console.error("broadcastBookAvailabilityUpdate failed", err),
      );
    }

    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    return NextResponse.json({
      success: true,
      data: {
        requestId: row.request_id,
        status: "BORROWED",
        availableCount: row.available_copies,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/requests/:id/approve]", error);
    return NextResponse.json(
      { error: "Failed to approve request." },
      { status: 500 },
    );
  }
}
