/**
 * PATCH /api/requests/:id/return
 *
 * Transitions a BORROWED request to RETURNED or LATE_RETURN.
 * Uses a single SQL statement for the status/counter mutation so it stays
 * atomic on the Neon HTTP driver.
 */
export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { borrowRecords } from "@/database/schema";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/dashboardSocketServer";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import dayjs from "dayjs";

type ReturnRow = {
  request_id: string;
  book_id: string;
  user_id: string;
  status: "RETURNED" | "LATE_RETURN";
  return_date: string;
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
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: recordId } = await params;

    const [current] = await db
      .select({
        id: borrowRecords.id,
        bookId: borrowRecords.bookId,
        userId: borrowRecords.userId,
        borrowStatus: borrowRecords.borrowStatus,
      })
      .from(borrowRecords)
      .where(eq(borrowRecords.id, recordId))
      .limit(1);

    if (!current) {
      return NextResponse.json(
        { error: "Borrow record not found." },
        { status: 404 },
      );
    }

    const isAdmin = session.user.role === "ADMIN";
    const isOwner = current.userId === session.user.id;
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (current.borrowStatus !== "BORROWED") {
      return NextResponse.json(
        { error: "Record is not currently in BORROWED status." },
        { status: 409 },
      );
    }

    const today = dayjs().format("YYYY-MM-DD");

    const result = await db.execute(sql`
      WITH updated_record AS (
        UPDATE borrow_records
        SET
          borrow_status = CASE
            WHEN due_date < ${today}::date THEN 'LATE_RETURN'::borrow_status
            ELSE 'RETURNED'::borrow_status
          END,
          return_date = ${today}::date
        WHERE id = ${recordId}
          AND borrow_status = 'BORROWED'::borrow_status
        RETURNING id, book_id, user_id, borrow_status, return_date
      ),
      updated_book AS (
        UPDATE books
        SET borrowed_count = GREATEST(0, borrowed_count - 1)
        WHERE id = (SELECT book_id FROM updated_record)
        RETURNING id, available_copies, reserved_count, borrowed_count
      )
      SELECT
        ur.id AS request_id,
        ur.book_id,
        ur.user_id,
        ur.borrow_status::text AS status,
        ur.return_date::text AS return_date,
        ub.available_copies,
        ub.reserved_count,
        ub.borrowed_count
      FROM updated_record ur
      LEFT JOIN updated_book ub ON TRUE;
    `);

    const row = (result.rows[0] as ReturnRow | undefined) ?? null;

    if (!row) {
      return NextResponse.json(
        { error: "Concurrent update detected. Please retry." },
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
        status: row.status,
        returnDate: row.return_date,
        isLate: row.status === "LATE_RETURN",
        availableCount: row.available_copies,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/requests/:id/return]", error);
    return NextResponse.json(
      { error: "Failed to process return." },
      { status: 500 },
    );
  }
}
