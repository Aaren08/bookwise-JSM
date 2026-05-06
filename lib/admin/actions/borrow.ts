"use server";

import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import { eq, desc, asc, count, sql, inArray } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/broadcast/dashboardSocketServer";
import { CACHE_TAGS } from "@/lib/performance/cache";
import {
  CONFLICT_ERROR_MESSAGE,
  publishEvent,
} from "@/lib/admin/realtime/concurrency/rowConcurrency";

type BorrowStatus = BorrowRecord["status"];

export const getAllBorrowRecords = async ({
  limit = 20,
  page = 1,
  sortOrder = "desc",
}: {
  limit?: number;
  page?: number;
  sortOrder?: "asc" | "desc";
}) => {
  try {
    const offset = (page - 1) * limit;
    const pagedBorrowRecords = db
      .select({
        id: borrowRecords.id,
        borrowDate: borrowRecords.borrowDate,
        dueDate: borrowRecords.dueDate,
        returnDate: borrowRecords.returnDate,
        status: borrowRecords.borrowStatus,
        bookId: borrowRecords.bookId,
        userId: borrowRecords.userId,
        updatedAt: borrowRecords.updatedAt,
        version: borrowRecords.version,
      })
      .from(borrowRecords)
      .orderBy(
        sortOrder === "asc"
          ? asc(borrowRecords.borrowDate)
          : desc(borrowRecords.borrowDate),
      )
      .limit(limit)
      .offset(offset)
      .as("paged_borrow_records");

    const recordsQuery = db
      .select({
        id: pagedBorrowRecords.id,
        borrowDate: pagedBorrowRecords.borrowDate,
        dueDate: pagedBorrowRecords.dueDate,
        returnDate: pagedBorrowRecords.returnDate,
        status: pagedBorrowRecords.status,
        updatedAt: pagedBorrowRecords.updatedAt,
        version: pagedBorrowRecords.version,
        bookTitle: books.title,
        bookCover: books.coverUrl,
        bookGenre: books.genre,
        userFullName: users.fullName,
        userEmail: users.email,
        userAvatar: users.userAvatar,
      })
      .from(pagedBorrowRecords)
      .innerJoin(books, eq(pagedBorrowRecords.bookId, books.id))
      .innerJoin(users, eq(pagedBorrowRecords.userId, users.id))
      .orderBy(
        sortOrder === "asc"
          ? asc(pagedBorrowRecords.borrowDate)
          : desc(pagedBorrowRecords.borrowDate),
      )
      .limit(limit)
      .offset(0);

    const [records, [{ value: totalRecords }]] = await Promise.all([
      recordsQuery,
      db.select({ value: count() }).from(borrowRecords),
    ]);

    const totalPages = Math.ceil(totalRecords / limit);

    return {
      success: true,
      data: {
        records: JSON.parse(JSON.stringify(records)),
        totalPages,
      },
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      message: "Failed to fetch borrow records",
    };
  }
};

export const getBorrowRecordById = async (borrowRecordId: string) => {
  const [record] = await db
    .select({
      id: borrowRecords.id,
      borrowDate: borrowRecords.borrowDate,
      dueDate: borrowRecords.dueDate,
      returnDate: borrowRecords.returnDate,
      status: borrowRecords.borrowStatus,
      updatedAt: borrowRecords.updatedAt,
      version: borrowRecords.version,
      bookTitle: books.title,
      bookCover: books.coverUrl,
      bookGenre: books.genre,
      userFullName: users.fullName,
      userEmail: users.email,
      userAvatar: users.userAvatar,
    })
    .from(borrowRecords)
    .innerJoin(books, eq(borrowRecords.bookId, books.id))
    .innerJoin(users, eq(borrowRecords.userId, users.id))
    .where(eq(borrowRecords.id, borrowRecordId))
    .limit(1);

  return record ? (JSON.parse(JSON.stringify(record)) as BorrowRecord) : null;
};

export const validateBorrowStatusTransition = async (
  currentStatus: BorrowStatus,
  nextStatus: BorrowStatus,
) => {
  const allowedTransitions: Record<BorrowStatus, BorrowStatus[]> = {
    PENDING: ["BORROWED", "REJECTED"],
    BORROWED: ["RETURNED", "LATE_RETURN"],
    RETURNED: [],
    LATE_RETURN: [],
    REJECTED: [],
  };

  return allowedTransitions[currentStatus].includes(nextStatus);
};

export const updateBorrowStatus = async ({
  borrowRecordId,
  status,
  expectedVersion,
}: {
  borrowRecordId: string;
  status: BorrowStatus;
  expectedVersion: number;
}) => {
  try {
    const currentRecord = await db
      .select()
      .from(borrowRecords)
      .where(eq(borrowRecords.id, borrowRecordId))
      .limit(1);

    if (!currentRecord.length) {
      return { success: false, message: "Borrow record not found" };
    }

    const record = currentRecord[0];
    const oldStatus = record.borrowStatus;
    const bookId = record.bookId;

    if (oldStatus === status) {
      return { success: true, message: "Status already set" };
    }

    if (!(await validateBorrowStatusTransition(oldStatus, status))) {
      return { success: false, message: "Invalid status transition" };
    }

    // Compute book counter deltas JS-side (same logic as before)
    let reservedChange = 0;
    let borrowedChange = 0;

    if (oldStatus === "PENDING") reservedChange--;
    else if (oldStatus === "BORROWED") borrowedChange--;

    if (status === "PENDING") reservedChange++;
    else if (status === "BORROWED") borrowedChange++;

    const returnDate =
      status === "RETURNED" || status === "LATE_RETURN"
        ? new Date().toISOString().slice(0, 10)
        : null;

    const needsBookUpdate = reservedChange !== 0 || borrowedChange !== 0;

    /**
     * Single atomic CTE — replaces the db.transaction() block.
     *
     * updated_record: updates borrow_records with an optimistic-lock version
     *   check. Returns 0 rows on conflict → all downstream CTEs are no-ops.
     *
     * updated_book: conditionally updates books counters only when:
     *   a) updated_record succeeded (EXISTS guard), AND
     *   b) at least one counter actually changes (needsBookUpdate param).
     *
     * current_book: fallback SELECT used when no counter update is needed,
     *   so the final SELECT always has book state to return.
     *
     * The COALESCE in the final SELECT merges both paths into one result row.
     */
    const queryResult = await db.execute(sql`
      WITH
      updated_record AS (
        UPDATE borrow_records
        SET
          borrow_status = ${status},
          return_date   = ${returnDate},
          updated_at    = NOW(),
          version       = version + 1
        WHERE
          id      = ${borrowRecordId}
          AND version = ${expectedVersion}
        RETURNING id, book_id
      ),
      updated_book AS (
        UPDATE books
        SET
          reserved_count = GREATEST(0, reserved_count + ${reservedChange}),
          borrowed_count = GREATEST(0, borrowed_count + ${borrowedChange}),
          updated_at     = NOW(),
          version        = version + 1
        WHERE
          id = (SELECT book_id FROM updated_record)
          AND EXISTS (SELECT 1 FROM updated_record)
          AND ${needsBookUpdate} = TRUE
        RETURNING available_copies, reserved_count, borrowed_count
      ),
      current_book AS (
        SELECT available_copies, reserved_count, borrowed_count
        FROM books
        WHERE
          id = (SELECT book_id FROM updated_record)
          AND NOT EXISTS (SELECT 1 FROM updated_book)
          AND EXISTS (SELECT 1 FROM updated_record)
      )
      SELECT
        (SELECT id FROM updated_record)   AS record_id,
        COALESCE(
          (SELECT available_copies FROM updated_book),
          (SELECT available_copies FROM current_book)
        )                                 AS available_copies,
        COALESCE(
          (SELECT reserved_count   FROM updated_book),
          (SELECT reserved_count   FROM current_book)
        )                                 AS reserved_count,
        COALESCE(
          (SELECT borrowed_count   FROM updated_book),
          (SELECT borrowed_count   FROM current_book)
        )                                 AS borrowed_count
    `);

    const result = queryResult.rows[0] as
      | {
          record_id: string | null;
          available_copies: number;
          reserved_count: number;
          borrowed_count: number;
        }
      | undefined;

    // No record_id → optimistic lock conflict (version mismatch)
    if (!result?.record_id) {
      throw new Error(CONFLICT_ERROR_MESSAGE);
    }

    const updatedBook = {
      availableCopies: result.available_copies,
      reservedCount: result.reserved_count,
      borrowedCount: result.borrowed_count,
    };

    if (updatedBook) {
      broadcastBookAvailabilityUpdate(
        bookId,
        updatedBook.availableCopies,
        updatedBook.reservedCount,
        updatedBook.borrowedCount,
      ).catch((err) =>
        console.error("broadcastBookAvailabilityUpdate failed", err),
      );
    }

    revalidatePath("/admin/borrow-records");
    revalidatePath("/my-profile");
    revalidatePath(`/admin/books/${bookId}`);
    revalidatePath("/admin/users");
    revalidateTag(CACHE_TAGS.books, "max");
    revalidateTag(CACHE_TAGS.users, "max");

    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    try {
      const realtimeRecord = await getBorrowRecordById(borrowRecordId);
      if (realtimeRecord) {
        await publishEvent("borrow_requests", {
          type: "UPDATE",
          entityId: borrowRecordId,
          data: realtimeRecord,
        });
      }
    } catch (realtimeError) {
      console.error(
        `Failed to publish realtime update for borrow status ${borrowRecordId}:`,
        realtimeError,
      );
    }

    return {
      success: true,
      data: { id: result.record_id },
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message:
        error instanceof Error && error.message === CONFLICT_ERROR_MESSAGE
          ? CONFLICT_ERROR_MESSAGE
          : "Failed to update borrow status",
    };
  }
};

export const clearBorrowRecords = async ({
  clearReturned = false,
  clearLateReturned = false,
  clearRejected = false,
}: {
  clearReturned?: boolean;
  clearLateReturned?: boolean;
  clearRejected?: boolean;
}) => {
  try {
    const statusesToClear: Array<"RETURNED" | "LATE_RETURN" | "REJECTED"> = [];

    if (clearReturned) {
      statusesToClear.push("RETURNED");
    }

    if (clearLateReturned) {
      statusesToClear.push("LATE_RETURN");
    }

    if (clearRejected) {
      statusesToClear.push("REJECTED");
    }

    if (statusesToClear.length === 0) {
      return {
        success: false,
        message: "No status selected for clearing",
      };
    }

    const deletedRecords = await db
      .delete(borrowRecords)
      .where(inArray(borrowRecords.borrowStatus, statusesToClear))
      .returning();

    revalidatePath("/admin/borrow-records");
    revalidatePath("/my-profile");
    revalidatePath("/admin/users");
    revalidateTag(CACHE_TAGS.users, "max");
    revalidateTag(CACHE_TAGS.books, "max");
    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    try {
      await Promise.all(
        deletedRecords.map((record) =>
          publishEvent("borrow_requests", {
            type: "DELETE",
            entityId: record.id,
            data: null,
          }),
        ),
      );
    } catch (realtimeError) {
      console.error(
        `Failed to publish realtime delete events for cleared borrow records:`,
        realtimeError,
      );
    }

    return {
      success: true,
      data: {
        deletedCount: deletedRecords.length,
        message: `Successfully cleared ${deletedRecords.length} record(s)`,
      },
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: "Failed to clear borrow records",
    };
  }
};
