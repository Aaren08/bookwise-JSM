export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/broadcast/dashboardSocketServer";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { NextResponse } from "next/server";
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
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: recordId } = await params;
    const body = (await request.json()) as {
      expectedVersion?: number;
      lockToken?: string;
    };

    if (typeof body.expectedVersion !== "number") {
      return NextResponse.json(
        { error: "Missing expectedVersion" },
        { status: 400 },
      );
    }
    const expectedVersion = body.expectedVersion;

    try {
      await assertLockOwnership(
        "borrow_requests",
        recordId,
        session.user.id,
        body.lockToken,
      );
    } catch (error) {
      if (error instanceof LockOwnershipError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: borrowRecords.id,
            bookId: borrowRecords.bookId,
            borrowStatus: borrowRecords.borrowStatus,
          })
          .from(borrowRecords)
          .where(eq(borrowRecords.id, recordId))
          .limit(1)
          .for("update");

        if (!current) {
          return { type: "not-found" as const };
        }

        if (
          !(await validateBorrowStatusTransition(
            current.borrowStatus,
            "REJECTED",
          ))
        ) {
          return { type: "invalid-transition" as const };
        }

        const [updatedRecord] = await tx
          .update(borrowRecords)
          .set({
            borrowStatus: "REJECTED",
            updatedAt: new Date(),
            version: sql`${borrowRecords.version} + 1`,
          })
          .where(
            and(
              eq(borrowRecords.id, recordId),
              eq(borrowRecords.borrowStatus, "PENDING"),
              eq(borrowRecords.version, expectedVersion),
            ),
          )
          .returning({
            id: borrowRecords.id,
            bookId: borrowRecords.bookId,
          });

        if (!updatedRecord) {
          return { type: "conflict" as const };
        }

        const [updatedBook] = await tx
          .update(books)
          .set({
            reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
            updatedAt: new Date(),
            version: sql`${books.version} + 1`,
          })
          .where(eq(books.id, updatedRecord.bookId))
          .returning({
            availableCopies: books.availableCopies,
            reservedCount: books.reservedCount,
            borrowedCount: books.borrowedCount,
            version: books.version,
          });

        return { type: "success" as const, current, updatedRecord, updatedBook };
      });

      if (result.type === "not-found") {
        return NextResponse.json(
          { error: "Borrow record not found." },
          { status: 404 },
        );
      }

      if (result.type === "invalid-transition") {
        return NextResponse.json(
          { error: "Invalid status transition" },
          { status: 409 },
        );
      }

      if (result.type === "conflict") {
        return NextResponse.json(
          { error: CONFLICT_ERROR_MESSAGE },
          { status: 409 },
        );
      }

      const { current, updatedBook } = result;

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
          updatedBook.version,
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
          `[PATCH /api/requests/:id/reject] Best-effort realtime publish failed for record ${recordId}:`,
          realtimeError,
        );
      }

      return NextResponse.json({
        success: true,
        data: realtimeRecord,
      });
    } finally {
      try {
        if (body.lockToken) {
          await releaseLock(
            "borrow_requests",
            recordId,
            session.user.id,
            body.lockToken,
          );
        }
      } catch (lockError) {
        console.error("releaseLock failed best-effort cleanup", {
          recordId,
          lockToken: "REDACTED",
          error: lockError,
        });
      }
    }
  } catch (error) {
    console.error("[PATCH /api/requests/:id/reject]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to reject request.",
      },
      { status: 500 },
    );
  }
}
