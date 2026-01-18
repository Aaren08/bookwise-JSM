"use server";

import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import { eq, desc, asc, count } from "drizzle-orm";
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
      .leftJoin(books, eq(borrowRecords.bookId, books.id))
      .leftJoin(users, eq(borrowRecords.userId, users.id))
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
  status: "BORROWED" | "RETURNED" | "LATE_RETURN";
}) => {
  try {
    const updateData: {
      borrowStatus: "BORROWED" | "RETURNED" | "LATE_RETURN";
      returnDate?: string;
    } = { borrowStatus: status };

    // Set returnDate when marking as returned or late return
    if (status === "RETURNED" || status === "LATE_RETURN") {
      updateData.returnDate = new Date().toISOString();
    }

    const updatedRecord = await db
      .update(borrowRecords)
      .set(updateData)
      .where(eq(borrowRecords.id, bookId))
      .returning();

    revalidatePath("/admin/borrow-records");
    revalidatePath("/my-profile");

    return {
      success: true,
      data: JSON.parse(JSON.stringify(updatedRecord[0])),
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      message: "Failed to update borrow status",
    };
  }
};
