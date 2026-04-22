/**
 * PATCH /api/requests/:id/approve
 *
 * Transitions a PENDING request to BORROWED.
 * - Atomically: reserved_count--, borrowed_count++
 * - If the record is no longer PENDING (race: already approved/rejected),
 *   returns 409 so the caller can refresh their UI.
 */
export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/dashboardSocketServer";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

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

    // ── 1. Atomically transition PENDING → BORROWED ──────────────────────────
    const [record] = await db
      .update(borrowRecords)
      .set({ borrowStatus: "BORROWED" })
      .where(
        and(
          eq(borrowRecords.id, recordId),
          eq(borrowRecords.borrowStatus, "PENDING"),
        ),
      )
      .returning({
        id: borrowRecords.id,
        bookId: borrowRecords.bookId,
        userId: borrowRecords.userId,
      });

    if (!record) {
      return NextResponse.json(
        { error: "Request not found or no longer pending." },
        { status: 409 },
      );
    }

    // ── 2. Atomically swap the counters: reserved-- borrowed++ ───────────────
    const [updatedBook] = await db
      .update(books)
      .set({
        reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
        borrowedCount: sql`${books.borrowedCount} + 1`,
      })
      .where(eq(books.id, record.bookId))
      .returning({
        availableCopies: books.availableCopies,
        reservedCount: books.reservedCount,
        borrowedCount: books.borrowedCount,
      });

    // ── 3. Revalidate + broadcast ─────────────────────────────────────────────
    revalidatePath("/admin/borrow-records");
    revalidatePath("/my-profile");
    revalidatePath(`/admin/books/${record.bookId}`);
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    if (updatedBook) {
      broadcastBookAvailabilityUpdate(
        record.bookId,
        updatedBook.availableCopies,
        updatedBook.reservedCount,
        updatedBook.borrowedCount,
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
        requestId: record.id,
        status: "BORROWED",
        availableCount: updatedBook?.availableCopies ?? null,
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
