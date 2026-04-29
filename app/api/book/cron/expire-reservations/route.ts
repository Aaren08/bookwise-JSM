/**
 * GET /api/book/cron/expire-reservations
 *
 * Background cron that expires stale PENDING reservations older than
 * RESERVATION_EXPIRY_MINUTES (default: 15 min).
 *
 * Designed to be called by:
 *   - Vercel Cron Jobs (set cron: "* * * * *" in vercel.json for every minute)
 *   - Any external scheduler (cURL, GitHub Actions, etc.)
 *
 * Auth: Protected by a shared CRON_SECRET header to prevent public triggering.
 *
 * Idempotent: Re-running on already-expired records is a no-op because the
 * WHERE clause filters by borrowStatus = 'PENDING'.
 */
export const runtime = "nodejs";

import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/dashboardSocketServer";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { eq, and, sql, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { publishEvent } from "@/lib/admin/realtime/concurrency/rowConcurrency";
import { getBorrowRecordById } from "@/lib/admin/actions/borrow";

const RESERVATION_EXPIRY_MINUTES = 15;

export async function GET(request: Request) {
  // ── Auth guard ─────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // ── 1. Find all expired PENDING records ──────────────────────────────────
    const expiredRecords = await db
      .select({
        id: borrowRecords.id,
        bookId: borrowRecords.bookId,
      })
      .from(borrowRecords)
      .where(
        and(
          eq(borrowRecords.borrowStatus, "PENDING"),
          sql`${borrowRecords.reservedAt} < NOW() - INTERVAL '${sql.raw(String(RESERVATION_EXPIRY_MINUTES))} minutes'`,
        ),
      );

    if (expiredRecords.length === 0) {
      return NextResponse.json({
        success: true,
        expired: 0,
        message: "No stale reservations found.",
      });
    }

    const expiredIds = expiredRecords.map((r) => r.id);

    // ── 2. Bulk-transition PENDING → REJECTED ─────────────────────────────────
    await db
      .update(borrowRecords)
      .set({ borrowStatus: "REJECTED", updatedAt: new Date() })
      .where(inArray(borrowRecords.id, expiredIds));

    // ── 3. Group by bookId and decrement each book's reserved_count ──────────
    const bookIdToExpiredCount = expiredRecords.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.bookId] = (acc[r.bookId] ?? 0) + 1;
        return acc;
      },
      {},
    );

    const broadcastPromises: Promise<void>[] = [];

    for (const [bookId, expiredCount] of Object.entries(bookIdToExpiredCount)) {
      const [updatedBook] = await db
        .update(books)
        .set({
          reservedCount: sql`GREATEST(0, ${books.reservedCount} - ${expiredCount})`,
          updatedAt: new Date(),
        })
        .where(eq(books.id, bookId))
        .returning({
          availableCopies: books.availableCopies,
          reservedCount: books.reservedCount,
          borrowedCount: books.borrowedCount,
        });

      if (updatedBook) {
        broadcastPromises.push(
          broadcastBookAvailabilityUpdate(
            bookId,
            updatedBook.availableCopies,
            updatedBook.reservedCount,
            updatedBook.borrowedCount,
          ).catch((err) =>
            console.error("broadcastBookAvailabilityUpdate failed", err),
          ),
        );
      }
    }

    // ── 4. Revalidate + broadcast ─────────────────────────────────────────────
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    await Promise.allSettled([
      ...broadcastPromises,
      broadcastAdminDashboardUpdate().catch((err) =>
        console.error("broadcastAdminDashboardUpdate failed", err),
      ),
      ...expiredIds.map(async (borrowRecordId) => {
        const record = await getBorrowRecordById(borrowRecordId);
        if (!record) return;

        await publishEvent("borrow_requests", {
          type: "UPDATE",
          entityId: borrowRecordId,
          data: record,
        });
      }),
    ]);

    console.log(
      `[expire-reservations] Expired ${expiredIds.length} reservations across ${Object.keys(bookIdToExpiredCount).length} book(s).`,
    );

    return NextResponse.json({
      success: true,
      expired: expiredIds.length,
      affectedBooks: Object.keys(bookIdToExpiredCount).length,
      message: `Expired ${expiredIds.length} stale reservation(s).`,
    });
  } catch (error) {
    console.error("[GET /api/book/cron/expire-reservations]", error);
    return NextResponse.json(
      { error: "Failed to expire reservations." },
      { status: 500 },
    );
  }
}
