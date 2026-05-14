/**
 * POST /api/requests
 *
 * Creates a new borrow request with PENDING status.
 *
 * Concurrency safety:
 *   Uses a real PostgreSQL transaction. A per-user/book advisory transaction
 *   lock prevents duplicate active requests, while the conditional books UPDATE
 *   serializes capacity changes on the book row.
 */
export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import { broadcastBookAvailabilityUpdate } from "@/lib/admin/realtime/broadcast/dashboardSocketServer";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { publishEvent } from "@/lib/admin/realtime/concurrency/rowConcurrency";
import { getBorrowRecordById } from "@/lib/admin/actions/borrow";
import {
  getBorrowDurationDays,
  getDueDateFromBorrowDuration,
} from "@/lib/global/system-config";

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
    const borrowDurationDays = await getBorrowDurationDays();
    const dueDate = getDueDateFromBorrowDuration(borrowDurationDays).format(
      "YYYY-MM-DD",
    );

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtext(${`borrow_request:${userId}:${bookId}`}))
      `);

      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || user.status !== "APPROVED") {
        return { type: "not-approved" as const };
      }

      const [existing] = await tx
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
        return { type: "duplicate" as const };
      }

      const expired = await tx
        .update(borrowRecords)
        .set({
          borrowStatus: "REJECTED",
          updatedAt: new Date(),
          version: sql`${borrowRecords.version} + 1`,
        })
        .where(
          and(
            eq(borrowRecords.bookId, bookId),
            eq(borrowRecords.borrowStatus, "PENDING"),
            sql`${borrowRecords.reservedAt} < NOW() - INTERVAL '15 minutes'`,
          ),
        )
        .returning({ id: borrowRecords.id });

      if (expired.length > 0) {
        await tx
          .update(books)
          .set({
            reservedCount: sql`GREATEST(0, ${books.reservedCount} - ${expired.length})`,
            updatedAt: new Date(),
            version: sql`${books.version} + 1`,
          })
          .where(eq(books.id, bookId));
      }

      const [updatedBook] = await tx
        .update(books)
        .set({
          reservedCount: sql`${books.reservedCount} + 1`,
          updatedAt: new Date(),
          version: sql`${books.version} + 1`,
        })
        .where(
          and(
            eq(books.id, bookId),
            sql`${books.reservedCount} + ${books.borrowedCount} < ${books.totalCopies}`,
          ),
        )
        .returning({
          availableCopies: books.availableCopies,
          reservedCount: books.reservedCount,
          borrowedCount: books.borrowedCount,
          version: books.version,
        });

      if (!updatedBook) {
        return { type: "unavailable" as const };
      }

      const [record] = await tx
        .insert(borrowRecords)
        .values({
          userId,
          bookId,
          dueDate,
          borrowStatus: "PENDING",
          reservedAt: new Date(),
          borrowDate: new Date(),
        })
        .returning({ id: borrowRecords.id });

      return { type: "success" as const, record, updatedBook };
    });

    if (result.type === "not-approved") {
      return NextResponse.json(
        { error: "Your account is not approved to borrow books." },
        { status: 403 },
      );
    }

    if (result.type === "duplicate") {
      return NextResponse.json(
        { error: "You already have an active request for this book." },
        { status: 409 },
      );
    }

    if (result.type === "unavailable") {
      return NextResponse.json(
        { error: "Book is not available for borrowing at this time." },
        { status: 409 },
      );
    }

    const { record, updatedBook } = result;

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
