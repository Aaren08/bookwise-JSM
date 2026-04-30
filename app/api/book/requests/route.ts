/**
 * POST /api/requests
 *
 * Creates a new borrow request with PENDING status.
 *
 * Concurrency safety:
 *   Uses an atomic conditional UPDATE: increments reserved_count only when
 *   (reserved_count + borrowed_count) < total_copies.
 *   If 0 rows are affected the book is at capacity — no race conditions possible
 *   because PostgreSQL UPDATE is always atomic.
 *
 * Reservation expiry:
 *   Sets reserved_at so the background cron can expire stale PENDING records.
 */
export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import { broadcastBookAvailabilityUpdate } from "@/lib/admin/realtime/dashboardSocketServer";
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

    // ── 3. Lazy expiry check: release stale PENDING reservations ────────────
    const expiredReservations = await db
      .update(borrowRecords)
      .set({
        borrowStatus: "REJECTED",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(borrowRecords.bookId, bookId),
          eq(borrowRecords.borrowStatus, "PENDING"),
          sql`${borrowRecords.reservedAt} < NOW() - INTERVAL '15 minutes'`,
        ),
      )
      .returning({ id: borrowRecords.id });

    // Reclaim reserved slots for any newly-expired reservations
    if (expiredReservations.length > 0) {
      await db
        .update(books)
        .set({
          reservedCount: sql`GREATEST(0, ${books.reservedCount} - ${expiredReservations.length})`,
          updatedAt: new Date(),
        })
        .where(eq(books.id, bookId));
    }

    // ── 4. Atomic reservation: increment reserved_count only if capacity exists
    const [updatedBook] = await db
      .update(books)
      .set({
        reservedCount: sql`${books.reservedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(books.id, bookId),
          // The CHECK: reserved + borrowed must be < total (capacity guard)
          sql`${books.reservedCount} + ${books.borrowedCount} < ${books.totalCopies}`,
        ),
      )
      .returning({
        availableCopies: books.availableCopies,
        reservedCount: books.reservedCount,
        borrowedCount: books.borrowedCount,
      });

    if (!updatedBook) {
      return NextResponse.json(
        { error: "Book is not available for borrowing at this time." },
        { status: 409 },
      );
    }

    // ── 5. Insert the PENDING borrow record ──────────────────────────────────
    const dueDate = dayjs().add(14, "days").format("YYYY-MM-DD");
    const now = new Date();

    const [record] = await db
      .insert(borrowRecords)
      .values({
        userId,
        bookId,
        dueDate,
        borrowStatus: "PENDING",
        reservedAt: now,
        borrowDate: now,
      })
      .returning({ id: borrowRecords.id });

    // ── 6. Revalidate + broadcast ─────────────────────────────────────────────
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    broadcastBookAvailabilityUpdate(
      bookId,
      updatedBook.availableCopies,
      updatedBook.reservedCount,
      updatedBook.borrowedCount,
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
    return NextResponse.json(
      { error: "Failed to create borrow request." },
      { status: 500 },
    );
  }
}
