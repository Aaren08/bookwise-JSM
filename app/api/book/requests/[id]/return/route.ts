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
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import dayjs from "dayjs";
import {
  CONFLICT_ERROR_MESSAGE,
  LockOwnershipError,
  assertLockOwnership,
  publishEvent,
  releaseLock,
} from "@/lib/admin/realtime/concurrency/rowConcurrency";
import {
  getBorrowRecordById,
  validateBorrowStatusTransition,
} from "@/lib/admin/actions/borrow";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: recordId } = await params;
    const body = (await request.json()) as {
      expectedVersion?: number;
      lockToken?: string;
    };

    const { expectedVersion, lockToken } = body;

    if (typeof expectedVersion !== "number") {
      return NextResponse.json(
        { error: "Missing expectedVersion" },
        { status: 400 },
      );
    }

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

    const isAdmin = session.user.role === "ADMIN";
    const isOwner = current.userId === session.user.id;
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (
      !(await validateBorrowStatusTransition(current.borrowStatus, "RETURNED"))
    ) {
      return NextResponse.json(
        { error: "Invalid status transition" },
        { status: 409 },
      );
    }

    if (isAdmin) {
      try {
        await assertLockOwnership(
          "borrow_requests",
          recordId,
          session.user.id,
          lockToken,
        );
      } catch (error) {
        if (error instanceof LockOwnershipError) {
          return NextResponse.json({ error: error.message }, { status: 409 });
        }
        throw error;
      }
    }

    try {
      const today = dayjs().format("YYYY-MM-DD");
      const resolvedStatus = dayjs(today).isAfter(dayjs(current.dueDate), "day")
        ? "LATE_RETURN"
        : "RETURNED";

      const result = await db.transaction(async (trx) => {
        const [updatedRecord] = await trx
          .update(borrowRecords)
          .set({
            borrowStatus: resolvedStatus,
            returnDate: today,
            updatedAt: new Date(),
            version: sql`${borrowRecords.version} + 1`,
          })
          .where(
            and(
              eq(borrowRecords.id, recordId),
              eq(borrowRecords.borrowStatus, "BORROWED"),
              eq(borrowRecords.version, expectedVersion),
            ),
          )
          .returning({ id: borrowRecords.id });

        if (!updatedRecord) {
          throw new Error(CONFLICT_ERROR_MESSAGE);
        }

        const [updatedBook] = await trx
          .update(books)
          .set({
            borrowedCount: sql`GREATEST(0, ${books.borrowedCount} - 1)`,
            updatedAt: new Date(),
            version: sql`${books.version} + 1`,
          })
          .where(eq(books.id, current.bookId))
          .returning({
            availableCopies: books.availableCopies,
            reservedCount: books.reservedCount,
            borrowedCount: books.borrowedCount,
          });

        return { updatedRecord, updatedBook };
      });

      const { updatedBook } = result;

      revalidatePath("/admin/borrow-records");
      revalidatePath("/my-profile");
      revalidatePath(`/admin/books/${current.bookId}`);
      revalidatePath("/admin/users");
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

      let realtimeRecord: BorrowRecord | null = null;
      try {
        realtimeRecord = await getBorrowRecordById(recordId);
        if (realtimeRecord) {
          await publishEvent("borrow_requests", {
            type: "UPDATE",
            entityId: recordId,
            data: realtimeRecord,
          });
        }
      } catch (realtimeError) {
        console.error(
          `[PATCH /api/requests/:id/return] Best-effort realtime publish failed for record ${recordId}:`,
          realtimeError,
        );
      }

      return NextResponse.json({
        success: true,
        data: realtimeRecord,
      });
    } finally {
      if (isAdmin) {
        try {
          await releaseLock(
            "borrow_requests",
            recordId,
            session.user.id,
            lockToken,
          );
        } catch (lockError) {
          console.error("releaseLock failed best-effort cleanup", {
            recordId,
            lockToken: "REDACTED",
            error: lockError,
          });
        }
      }
    }
  } catch (error) {
    console.error("[PATCH /api/requests/:id/return]", error);
    const message =
      error instanceof Error ? error.message : "Failed to process return.";
    if (message === CONFLICT_ERROR_MESSAGE) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
