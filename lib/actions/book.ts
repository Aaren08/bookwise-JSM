"use server";

import { eq, and } from "drizzle-orm";
import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
import { auth } from "@/auth";
import dayjs from "dayjs";

export const borrowBook = async (params: BorrowBookParams) => {
  const { userId, bookId } = params;

  try {
    const book = await db
      .select({ availableCopies: books.availableCopies })
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1);

    if (!book.length || book[0].availableCopies <= 0) {
      return {
        success: false,
        error: "Book is not available for borrowing",
      };
    }

    const existingBorrow = await db
      .select()
      .from(borrowRecords)
      .where(
        and(
          eq(borrowRecords.userId, userId),
          eq(borrowRecords.bookId, bookId),
          eq(borrowRecords.borrowStatus, "BORROWED")
        )
      )
      .limit(1);

    if (existingBorrow.length > 0) {
      return {
        success: false,
        error: "You have already borrowed this book",
      };
    }

    const dueDate = dayjs().add(14, "days").toDate().toISOString();

    const record = await db.insert(borrowRecords).values({
      userId,
      bookId,
      dueDate,
      borrowStatus: "BORROWED",
    });

    await db
      .update(books)
      .set({ availableCopies: book[0].availableCopies - 1 })
      .where(eq(books.id, bookId));

    return {
      success: true,
      data: JSON.parse(JSON.stringify(record)),
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to borrow book",
    };
  }
};

export const dismissBorrowRecord = async (borrowRecordId: string) => {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Verify the record belongs to the user
    const record = await db
      .select()
      .from(borrowRecords)
      .where(eq(borrowRecords.id, borrowRecordId))
      .limit(1);

    if (!record.length) {
      return {
        success: false,
        error: "Record not found",
      };
    }

    if (record[0].userId !== session.user.id && session.user.role !== "ADMIN") {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Update the record to dismissed
    await db
      .update(borrowRecords)
      .set({ dismissed: 1 })
      .where(eq(borrowRecords.id, borrowRecordId));

    return {
      success: true,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to dismiss record",
    };
  }
};
