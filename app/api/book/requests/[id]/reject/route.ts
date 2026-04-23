/**
 * PATCH /api/requests/:id/reject
 *
 * Transitions a PENDING request to REJECTED.
 * - Atomically decrements reserved_count.
 * - Idempotent: returns 409 if record is not currently PENDING.
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

    // ── 1. Atomically transition PENDING → REJECTED ──────────────────────────
    const [record] = await db
      .update(borrowRecords)
      .set({ borrowStatus: "REJECTED" })
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

    // ── 2. Release the reserved slot ─────────────────────────────────────────
    const [updatedBook] = await db
      .update(books)
      .set({
        reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
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
        status: "REJECTED",
        availableCount: updatedBook?.availableCopies ?? null,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/requests/:id/reject]", error);
    return NextResponse.json(
      { error: "Failed to reject request." },
      { status: 500 },
    );
  }
}
