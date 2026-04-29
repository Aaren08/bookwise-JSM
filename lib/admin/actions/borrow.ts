"use server";

import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import { eq, desc, asc, count, sql, inArray } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  broadcastAdminDashboardUpdate,
  broadcastBookAvailabilityUpdate,
} from "@/lib/admin/realtime/dashboardSocketServer";
import { CACHE_TAGS } from "@/lib/performance/cache";
import {
  CONFLICT_ERROR_MESSAGE,
  publishEvent,
  updateWithVersionCheck,
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

    const updateData: Partial<typeof borrowRecords.$inferInsert> = {
      borrowStatus: status,
      returnDate:
        status === "RETURNED" || status === "LATE_RETURN"
          ? new Date().toISOString().slice(0, 10)
          : null,
    };

    let reservedChange = 0;
    let borrowedChange = 0;

    if (oldStatus === "PENDING") reservedChange--;
    else if (oldStatus === "BORROWED") borrowedChange--;

    if (status === "PENDING") reservedChange++;
    else if (status === "BORROWED") borrowedChange++;

    const updatedRecord = await updateWithVersionCheck({
      table: borrowRecords,
      idColumn: borrowRecords.id,
      versionColumn: borrowRecords.version,
      id: borrowRecordId,
      expectedVersion,
      values: updateData,
    });

    let updatedBook:
      | {
          availableCopies: number;
          reservedCount: number;
          borrowedCount: number;
        }
      | undefined;

    if (reservedChange !== 0 || borrowedChange !== 0) {
      [updatedBook] = await db
        .update(books)
        .set({
          reservedCount: sql`GREATEST(0, ${books.reservedCount} + ${reservedChange})`,
          borrowedCount: sql`GREATEST(0, ${books.borrowedCount} + ${borrowedChange})`,
          updatedAt: new Date(),
          version: sql`${books.version} + 1`,
        })
        .where(eq(books.id, bookId))
        .returning({
          availableCopies: books.availableCopies,
          reservedCount: books.reservedCount,
          borrowedCount: books.borrowedCount,
        });
    } else {
      [updatedBook] = await db
        .select({
          availableCopies: books.availableCopies,
          reservedCount: books.reservedCount,
          borrowedCount: books.borrowedCount,
        })
        .from(books)
        .where(eq(books.id, bookId))
        .limit(1);
    }

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

    const realtimeRecord = await getBorrowRecordById(borrowRecordId);
    if (realtimeRecord) {
      await publishEvent("borrow_requests", {
        type: "UPDATE",
        entityId: borrowRecordId,
        data: realtimeRecord,
      });
    }

    return {
      success: true,
      data: updatedRecord,
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

    await Promise.all(
      deletedRecords.map((record) =>
        publishEvent("borrow_requests", {
          type: "DELETE",
          entityId: record.id,
          data: null,
        }),
      ),
    );

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
