/**
 * PATCH /api/requests/:id/return
 *
 * Transitions a BORROWED request to RETURNED or LATE_RETURN.
 * - Automatically detects overdue based on dueDate.
 * - Atomically decrements borrowed_count.
 * - Returns 409 if record is not currently BORROWED (idempotent).
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
import dayjs from "dayjs";

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

    // ── 1. Fetch the current record to determine if it's overdue ────────────
    const [current] = await db
      .select({
        id: borrowRecords.id,
        bookId: borrowRecords.bookId,
        userId: borrowRecords.userId,
        dueDate: borrowRecords.dueDate,
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

    // Only ADMIN or the record's owner can return
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
    const isLate = dayjs(today).isAfter(dayjs(current.dueDate));
    const newStatus = isLate ? "LATE_RETURN" : "RETURNED";
    const returnDate = today;

    // ── 2. Atomically transition BORROWED → RETURNED / LATE_RETURN ──────────
    const [updatedRecord] = await db
      .update(borrowRecords)
      .set({
        borrowStatus: newStatus,
        returnDate,
      })
      .where(
        and(
          eq(borrowRecords.id, recordId),
          eq(borrowRecords.borrowStatus, "BORROWED"),
        ),
      )
      .returning({ id: borrowRecords.id });

    if (!updatedRecord) {
      return NextResponse.json(
        { error: "Concurrent update detected — please retry." },
        { status: 409 },
      );
    }

    // ── 3. Decrement borrowed_count ──────────────────────────────────────────
    const [updatedBook] = await db
      .update(books)
      .set({
        borrowedCount: sql`GREATEST(0, ${books.borrowedCount} - 1)`,
      })
      .where(eq(books.id, current.bookId))
      .returning({
        availableCopies: books.availableCopies,
        reservedCount: books.reservedCount,
        borrowedCount: books.borrowedCount,
      });

    // ── 4. Revalidate + broadcast ─────────────────────────────────────────────
    revalidatePath("/admin/borrow-records");
    revalidatePath("/my-profile");
    revalidatePath(`/admin/books/${current.bookId}`);
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    if (updatedBook) {
      broadcastBookAvailabilityUpdate(
        current.bookId,
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
        requestId: current.id,
        status: newStatus,
        returnDate,
        isLate,
        availableCount: updatedBook?.availableCopies ?? null,
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
