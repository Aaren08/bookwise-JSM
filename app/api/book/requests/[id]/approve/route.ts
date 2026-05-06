export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
import { eq, sql } from "drizzle-orm";
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
      const [current] = await db
        .select({
          id: borrowRecords.id,
          bookId: borrowRecords.bookId,
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

      if (
        !(await validateBorrowStatusTransition(
          current.borrowStatus,
          "BORROWED",
        ))
      ) {
        return NextResponse.json(
          { error: "Invalid status transition" },
          { status: 409 },
        );
      }

      const result = await db.execute<{
        id: string;
        availableCopies: number;
        reservedCount: number;
        borrowedCount: number;
        version: number;
      }>(sql`
        WITH updated_borrow AS (
          UPDATE ${borrowRecords}
          SET borrow_status = 'BORROWED',
              updated_at = NOW(),
              version = version + 1
          WHERE id = ${recordId}
            AND borrow_status = 'PENDING'
            AND version = ${body.expectedVersion}
          RETURNING id, book_id
        ),
        updated_book AS (
          UPDATE ${books}
          SET reserved_count = GREATEST(0, reserved_count - 1),
              borrowed_count = borrowed_count + 1,
              updated_at = NOW(),
              version = version + 1
          WHERE id = (SELECT book_id FROM updated_borrow)
          RETURNING available_copies, reserved_count, borrowed_count, version
        )
        SELECT
          ub.id,
          bk.available_copies as "availableCopies",
          bk.reserved_count as "reservedCount",
          bk.borrowed_count as "borrowedCount",
          bk.version as "version"
        FROM updated_borrow ub
        JOIN updated_book bk ON true;
      `);

      const [row] = result.rows;

      if (!row) {
        return NextResponse.json(
          { error: CONFLICT_ERROR_MESSAGE },
          { status: 409 },
        );
      }

      const updatedBook = row;

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
          `[PATCH /api/requests/:id/approve] Best-effort realtime publish failed for record ${recordId}:`,
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
          lockToken: body.lockToken,
          error: lockError,
        });
      }
    }
  } catch (error) {
    console.error("[PATCH /api/requests/:id/approve]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to approve request.",
      },
      { status: 500 },
    );
  }
}
