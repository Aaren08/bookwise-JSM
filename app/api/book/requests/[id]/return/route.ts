export const runtime = "nodejs";

import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { borrowRecords } from "@/database/schema";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/broadcast/dashboardSocketServer";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/performance/cache";
import { eq, sql } from "drizzle-orm";
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

      /**
       * Single atomic CTE — replaces the db.transaction() block.
       *
       * updated_record: updates the borrow record with an optimistic-lock
       *   version check. Returns 0 rows on conflict → books UPDATE is skipped.
       *
       * updated_book: updates books only when updated_record succeeded
       *   (EXISTS guard). This gives all-or-nothing semantics without a
       *   transaction, which is required by the Neon HTTP driver.
       */
      const rows = await db.execute(sql`
        WITH updated_record AS (
          UPDATE borrow_records
          SET
            borrow_status = ${resolvedStatus},
            return_date   = ${today},
            updated_at    = NOW(),
            version       = version + 1
          WHERE
            id            = ${recordId}
            AND borrow_status = 'BORROWED'
            AND version   = ${expectedVersion}
          RETURNING id
        ),
        updated_book AS (
          UPDATE books
          SET
            borrowed_count = GREATEST(0, borrowed_count - 1),
            updated_at     = NOW(),
            version        = version + 1
          WHERE
            id = ${current.bookId}
            AND EXISTS (SELECT 1 FROM updated_record)
          RETURNING available_copies, reserved_count, borrowed_count, version
        )
        SELECT
          (SELECT id FROM updated_record) AS record_id,
          ub.available_copies,
          ub.reserved_count,
          ub.borrowed_count,
          ub.version
        FROM updated_book ub
      `);

      const result = rows.rows[0] as
        | {
            record_id: string | null;
            available_copies: number;
            reserved_count: number;
            borrowed_count: number;
            version: number;
          }
        | undefined;

      // No row returned → version mismatch or status was not BORROWED
      if (!result?.record_id) {
        throw new Error(CONFLICT_ERROR_MESSAGE);
      }

      const updatedRecord = { id: result.record_id };
      const updatedBook = {
        availableCopies: result.available_copies,
        reservedCount: result.reserved_count,
        borrowedCount: result.borrowed_count,
        version: result.version,
      };

      revalidatePath("/admin/borrow-records");
      revalidatePath("/my-profile");
      revalidatePath(`/admin/books/${current.bookId}`);
      revalidatePath("/admin/users");
      revalidateTag(CACHE_TAGS.books, "max");
      revalidateTag(CACHE_TAGS.users, "max");

      broadcastBookAvailabilityUpdate(
        current.bookId,
        updatedBook.availableCopies,
        updatedBook.reservedCount,
        updatedBook.borrowedCount,
        updatedBook.version,
      ).catch((err) =>
        console.error("broadcastBookAvailabilityUpdate failed", err),
      );

      broadcastAdminDashboardUpdate().catch((err) =>
        console.error("broadcastAdminDashboardUpdate failed", err),
      );

      let realtimeRecord: BorrowRecord | null = null;
      try {
        realtimeRecord = await getBorrowRecordById(updatedRecord.id);
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
          if (lockToken) {
            await releaseLock(
              "borrow_requests",
              recordId,
              session.user.id,
              lockToken,
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
