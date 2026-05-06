"use server";

import { revalidateTag } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
import { auth } from "@/auth";
import dayjs from "dayjs";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/broadcast/dashboardSocketServer";
import { CACHE_TAGS, getSimilarBooksCached } from "@/lib/performance/cache";
import { sql } from "drizzle-orm";
import { publishEvent } from "@/lib/admin/realtime/concurrency/rowConcurrency";
import { getBorrowRecordById } from "@/lib/admin/actions/borrow";

/**
 * borrowBook — Server Action
 *
 * Production-safe borrow request creation with:
 *  - Atomic conditional UPDATE (no SELECT then UPDATE race condition)
 *  - Duplicate-request guard (same user + book + active status)
 *  - Correct reservation accounting: only reserved_count incremented (NOT borrowed_count)
 *  - Real-time broadcast after commit
 */
export const borrowBook = async (params: BorrowBookParams) => {
  const { userId, bookId } = params;

  try {
    // ── 1. Gate: no active (PENDING or BORROWED) record for this user+book ───
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
      return {
        success: false,
        error: "You already have an active request for this book.",
      };
    }

    // ── 2. Lazy expiry: release any stale PENDING slots for this book ─────────
    //    This runs before checking availability so freed slots are counted.
    const staleExpiry = await db
      .update(borrowRecords)
      .set({ borrowStatus: "REJECTED", updatedAt: new Date() })
      .where(
        and(
          eq(borrowRecords.bookId, bookId),
          eq(borrowRecords.borrowStatus, "PENDING"),
          sql`${borrowRecords.reservedAt} < NOW() - INTERVAL '15 minutes'`,
        ),
      )
      .returning({ id: borrowRecords.id });

    // Reclaim reserved_count for any expired records
    if (staleExpiry.length > 0) {
      await db
        .update(books)
        .set({
          reservedCount: sql`GREATEST(0, ${books.reservedCount} - ${staleExpiry.length})`,
          updatedAt: new Date(),
        })
        .where(eq(books.id, bookId));
    }

    // ── 3. Atomic reservation: only proceeds when capacity exists ─────────────
    //    reserved_count + borrowed_count < total_copies  → safe to reserve
    const [updatedBook] = await db
      .update(books)
      .set({
        reservedCount: sql`${books.reservedCount} + 1`,
        updatedAt: new Date(),
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
      return {
        success: false,
        error: "Book is not available for requesting at this time.",
      };
    }

    // ── 4. Insert the PENDING borrow record ───────────────────────────────────
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

    // ── 5. Revalidate caches + fire-and-forget broadcast ──────────────────────
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    broadcastBookAvailabilityUpdate(
      bookId,
      updatedBook.availableCopies,
      updatedBook.reservedCount,
      updatedBook.borrowedCount,
      updatedBook.version,
    ).catch((err) =>
      console.error("Failed to broadcast book availability update:", err),
    );

    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("Failed to broadcast dashboard update:", err),
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
        `Failed to publish realtime update for borrow request ${record.id}:`,
        realtimeError,
      );
    }

    return {
      success: true,
      data: { id: record.id, status: "PENDING" },
    };
  } catch (error) {
    console.error("[borrowBook]", error);
    return {
      success: false,
      error: "Failed to initiate book request.",
    };
  }
};

export const dismissBorrowRecord = async (borrowRecordId: string) => {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Verify the record belongs to the user
    const record = await db
      .select()
      .from(borrowRecords)
      .where(eq(borrowRecords.id, borrowRecordId))
      .limit(1);

    if (!record.length) {
      return {
        success: false,
        error: "Record not found",
      };
    }

    if (record[0].userId !== session.user.id && session.user.role !== "ADMIN") {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Update the record to dismissed
    await db
      .update(borrowRecords)
      .set({ dismissed: 1, updatedAt: new Date() })
      .where(eq(borrowRecords.id, borrowRecordId));

    revalidateTag(CACHE_TAGS.users, "max");

    return {
      success: true,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to dismiss record",
    };
  }
};

export const getSimilarBooks = async (bookId: string) => {
  try {
    const similarBooks = await getSimilarBooksCached(bookId);

    return {
      success: true,
      data: JSON.parse(JSON.stringify(similarBooks)),
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to fetch similar books",
    };
  }
};
