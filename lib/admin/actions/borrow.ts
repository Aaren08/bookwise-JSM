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

    const recordsQuery = db
      .select({
        id: borrowRecords.id,
        borrowDate: borrowRecords.borrowDate,
        dueDate: borrowRecords.dueDate,
        returnDate: borrowRecords.returnDate,
        status: borrowRecords.borrowStatus,
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
      .orderBy(
        sortOrder === "asc"
          ? asc(borrowRecords.borrowDate)
          : desc(borrowRecords.borrowDate),
      )
      .limit(limit)
      .offset(offset);

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

export const updateBorrowStatus = async ({
  borrowRecordId, // Renamed from bookId to be clearer (it was used as record ID)
  status,
}: {
  borrowRecordId: string;
  status: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED";
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

    const updateData: Partial<typeof borrowRecords.$inferInsert> = {
      borrowStatus: status,
    };
    if (status === "RETURNED" || status === "LATE_RETURN") {
      updateData.returnDate = new Date().toISOString().slice(0, 10);
    } else {
      updateData.returnDate = null;
    }

    // 1️⃣ Update borrow record and book counters in a transaction
    const result = await db.transaction(async (tx) => {
      // Update record
      const [updatedRecord] = await tx
        .update(borrowRecords)
        .set(updateData)
        .where(eq(borrowRecords.id, borrowRecordId))
        .returning();

      // Adjust counters based on status transition
      let reservedChange = 0;
      let borrowedChange = 0;

      // Handle old status release
      if (oldStatus === "PENDING") reservedChange--;
      else if (oldStatus === "BORROWED") borrowedChange--;

      // Handle new status addition
      if (status === "PENDING") reservedChange++;
      else if (status === "BORROWED") borrowedChange++;

      if (reservedChange !== 0 || borrowedChange !== 0) {
        const [updatedBook] = await tx
          .update(books)
          .set({
            reservedCount: sql`GREATEST(0, ${books.reservedCount} + ${reservedChange})`,
            borrowedCount: sql`GREATEST(0, ${books.borrowedCount} + ${borrowedChange})`,
          })
          .where(eq(books.id, bookId))
          .returning({
            availableCopies: books.availableCopies,
            reservedCount: books.reservedCount,
            borrowedCount: books.borrowedCount,
          });

        return { updatedRecord, updatedBook };
      }

      // If no counter change, just get current book stats for broadcast
      const [currentBook] = await tx
        .select({
          availableCopies: books.availableCopies,
          reservedCount: books.reservedCount,
          borrowedCount: books.borrowedCount,
        })
        .from(books)
        .where(eq(books.id, bookId))
        .limit(1);

      return { updatedRecord, updatedBook: currentBook };
    });

    // 2️⃣ Broadcast updates
    if (result.updatedBook) {
      broadcastBookAvailabilityUpdate(
        bookId,
        result.updatedBook.availableCopies,
        result.updatedBook.reservedCount,
        result.updatedBook.borrowedCount,
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

    return {
      success: true,
      data: result.updatedRecord,
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Failed to update borrow status" };
  }
};

export const clearBorrowRecords = async ({
  clearReturned = false,
  clearLateReturned = false,
}: {
  clearReturned?: boolean;
  clearLateReturned?: boolean;
}) => {
  try {
    const statusesToClear: Array<"RETURNED" | "LATE_RETURN"> = [];

    if (clearReturned) {
      statusesToClear.push("RETURNED");
    }

    if (clearLateReturned) {
      statusesToClear.push("LATE_RETURN");
    }

    if (statusesToClear.length === 0) {
      return {
        success: false,
        message: "No status selected for clearing",
      };
    }

    // Delete records with the specified statuses
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
