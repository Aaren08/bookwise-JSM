/**
 * POST /api/requests
 *
 * Creates a new borrow request with PENDING status.
 *
 * Concurrency safety:
 *   Uses a single atomic CTE chain instead of a transaction (required by the
 *   Neon HTTP driver). The chain:
 *     1. Expires stale PENDING reservations for the book.
 *     2. Reclaims reserved slots from those expired rows.
 *     3. Atomically increments reserved_count only when capacity exists.
 *     4. Inserts the PENDING borrow record — gated on step 3 succeeding.
 *
 *   If step 3 matches 0 rows (book at capacity), step 4 is skipped via
 *   WHERE EXISTS, giving all-or-nothing semantics without BEGIN/COMMIT.
 */
export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { borrowRecords, users } from "@/database/schema";
import { broadcastBookAvailabilityUpdate } from "@/lib/admin/realtime/broadcast/dashboardSocketServer";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { eq, and, sql } from "drizzle-orm";
import dayjs from "dayjs";
import { NextResponse } from "next/server";
import { publishEvent } from "@/lib/admin/realtime/concurrency/rowConcurrency";
import { getBorrowRecordById } from "@/lib/admin/actions/borrow";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookId } = (await request.json()) as { bookId?: string };
    if (!bookId) {
      return NextResponse.json(
        { error: "bookId is required" },
        { status: 400 },
      );
    }

    const userId = session.user.id;

    // ── 1. Gate: user must be APPROVED ─────────────────────────────────────
    const [user] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || user.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Your account is not approved to borrow books." },
        { status: 403 },
      );
    }

    // ── 2. Gate: no active (PENDING or BORROWED) record for same book ───────
    const [existing] = await db
      .select({ id: borrowRecords.id })
      .from(borrowRecords)
      .where(
        and(
          eq(borrowRecords.userId, userId),
          eq(borrowRecords.bookId, bookId),
          sql`${borrowRecords.borrowStatus} IN ('PENDING', 'BORROWED')`,
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "You already have an active request for this book." },
        { status: 409 },
      );
    }

    const dueDate = dayjs().add(14, "days").format("YYYY-MM-DD");

    /**
     * Single atomic CTE — replaces the db.transaction() block.
     *
     * expired:        marks stale PENDING reservations as REJECTED.
     * reclaimed_book: subtracts their slots from reserved_count.
     * reserved_book:  increments reserved_count only when capacity exists
     *                 (reserved + borrowed < total_copies). Returns 0 rows
     *                 if the book is full — which cascades to skip step 4.
     * new_record:     inserts the PENDING row, gated on reserved_book.
     */
    const rows = await db.execute(sql`
      WITH
      expired AS (
        UPDATE borrow_records
        SET
          borrow_status = 'REJECTED',
          updated_at    = NOW(),
          version       = version + 1
        WHERE
          book_id       = ${bookId}
          AND borrow_status = 'PENDING'
          AND reserved_at   < NOW() - INTERVAL '15 minutes'
        RETURNING id
      ),
      reclaimed_book AS (
        UPDATE books
        SET
          reserved_count = GREATEST(0, reserved_count - (SELECT COUNT(*) FROM expired)),
          updated_at     = NOW(),
          version        = version + 1
        WHERE
          id = ${bookId}
          AND (SELECT COUNT(*) FROM expired) > 0
        RETURNING reserved_count
      ),
      reserved_book AS (
        UPDATE books
        SET
          reserved_count = reserved_count + 1,
          updated_at     = NOW(),
          version        = version + 1
        WHERE
          id = ${bookId}
          AND reserved_count + borrowed_count < total_copies
        RETURNING available_copies, reserved_count, borrowed_count, version
      ),
      new_record AS (
        INSERT INTO borrow_records
          (user_id, book_id, due_date, borrow_status, reserved_at, borrow_date)
        SELECT
          ${userId},
          ${bookId},
          ${dueDate}::date,
          'PENDING',
          NOW(),
          NOW()
        WHERE EXISTS (SELECT 1 FROM reserved_book)
        RETURNING id
      )
      SELECT
        (SELECT id FROM new_record)  AS record_id,
        rb.available_copies,
        rb.reserved_count,
        rb.borrowed_count,
        rb.version
      FROM reserved_book rb
    `);

    const result = rows.rows?.[0] as
      | {
          record_id: string | null;
          available_copies: number;
          reserved_count: number;
          borrowed_count: number;
          version: number;
        }
      | undefined;

    // No row → reserved_book matched 0 rows → book is at capacity
    if (!result?.record_id) {
      return NextResponse.json(
        { error: "Book is not available for borrowing at this time." },
        { status: 409 },
      );
    }

    const updatedBook = {
      availableCopies: result.available_copies,
      reservedCount: result.reserved_count,
      borrowedCount: result.borrowed_count,
      version: result.version,
    };
    const record = { id: result.record_id };

    // ── 3. Revalidate + broadcast ─────────────────────────────────────────────
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    broadcastBookAvailabilityUpdate(
      bookId,
      updatedBook.availableCopies,
      updatedBook.reservedCount,
      updatedBook.borrowedCount,
      updatedBook.version,
    ).catch((err) =>
      console.error("broadcastBookAvailabilityUpdate failed", err),
    );

    try {
      const realtimeRecord = await getBorrowRecordById(record.id);
      if (realtimeRecord) {
        await publishEvent("borrow_requests", {
          type: "CREATE",
          entityId: record.id,
          data: realtimeRecord,
        });
      }
    } catch (realtimeError) {
      console.error(
        `[POST /api/requests] Best-effort realtime publish failed for record ${record.id}:`,
        realtimeError,
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          requestId: record.id,
          status: "PENDING",
          availableCount: updatedBook.availableCopies,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[POST /api/requests]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create borrow request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
