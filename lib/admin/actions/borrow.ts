"use server";

import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import { eq, desc, asc, count, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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
        userAvatar: users.universityCard, // Assuming we might want to show something else or fetch avatar if available, but schema doesn't have avatarUrl explicitly, using universityCard as placeholder or just initials
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
  bookId,
  status,
}: {
  bookId: string;
  status: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
}) => {
  try {
    const currentRecord = await db
      .select()
      .from(borrowRecords)
      .where(eq(borrowRecords.id, bookId))
      .limit(1);

    if (!currentRecord.length) {
      return { success: false, message: "Borrow record not found" };
    }

    const record = currentRecord[0];
    const oldStatus = record.borrowStatus;

    let availableCopiesChange = 0;

    if (
      (oldStatus === "BORROWED" || oldStatus === "PENDING") &&
      (status === "RETURNED" || status === "LATE_RETURN")
    ) {
      availableCopiesChange = 1;
    } else if (
      (oldStatus === "RETURNED" || oldStatus === "LATE_RETURN") &&
      (status === "BORROWED" || status === "PENDING")
    ) {
      availableCopiesChange = -1;
    }

    const updateData: {
      borrowStatus: typeof status;
      returnDate?: string | null;
    } = { borrowStatus: status };

    updateData.returnDate =
      status === "RETURNED" || status === "LATE_RETURN"
        ? new Date().toISOString().slice(0, 10)
        : null;

    // 1️⃣ Update borrow record
    const updatedRecord = await db
      .update(borrowRecords)
      .set(updateData)
      .where(eq(borrowRecords.id, bookId))
      .returning();

    // 2️⃣ Update book copies (atomic SQL update)
    if (availableCopiesChange !== 0) {
      await db
        .update(books)
        .set({
          availableCopies: sql`${books.availableCopies} + ${availableCopiesChange}`,
        })
        .where(eq(books.id, record.bookId));
    }

    revalidatePath("/admin/borrow-records");
    revalidatePath("/my-profile");
    revalidatePath(`/admin/books/${record.bookId}`);

    return {
      success: true,
      data: updatedRecord[0],
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Failed to update borrow status" };
  }
};
