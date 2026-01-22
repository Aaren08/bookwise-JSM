"use server";

import { db } from "@/database/drizzle";
import { borrowRecords, books, users } from "@/database/schema";
import { eq } from "drizzle-orm";
import dayjs from "dayjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

export const generateReceipt = async (borrowRecordId: string) => {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Fetch the borrow record with book and user details
    const record = await db
      .select({
        id: borrowRecords.id,
        borrowDate: borrowRecords.borrowDate,
        dueDate: borrowRecords.dueDate,
        bookTitle: books.title,
        bookAuthor: books.author,
        bookGenre: books.genre,
        userFullName: users.fullName,
        userEmail: users.email,
        borrowStatus: borrowRecords.borrowStatus,
      })
      .from(borrowRecords)
      .innerJoin(books, eq(borrowRecords.bookId, books.id))
      .innerJoin(users, eq(borrowRecords.userId, users.id))
      .where(eq(borrowRecords.id, borrowRecordId))
      .limit(1);

    if (!record.length) {
      return {
        success: false,
        error: "Borrow record not found",
      };
    }

    const data = record[0];

    if (
      data.borrowStatus === "RETURNED" ||
      data.borrowStatus === "LATE_RETURN"
    ) {
      return {
        success: false,
        error: `Cannot generate receipt for a record that is already ${data.borrowStatus.toLowerCase().replace("_", " ")}`,
      };
    }

    // Update the record to BORROWED and set current dates
    const now = new Date();
    const dueDateObj = dayjs().add(14, "days").toDate();

    await db
      .update(borrowRecords)
      .set({
        borrowStatus: "BORROWED",
        borrowDate: now,
        dueDate: dayjs(dueDateObj).format("YYYY-MM-DD"),
      })
      .where(eq(borrowRecords.id, borrowRecordId));

    revalidatePath("/admin/borrow-records");

    // Format dates for receipt
    const issuedAt = dayjs(now).format("DD/MM/YYYY, hh:mm A");
    const borrowedOn = dayjs(now).format("DD/MM/YYYY");
    const dueDate = dayjs(dueDateObj).format("DD/MM/YYYY");

    // Calculate duration (just an example, or could be fixed 14 days)
    const duration = "14 Days";

    const receipt = {
      receiptId: data.id.substring(0, 8).toUpperCase(), // Short ID for display
      issuedAt,
      title: data.bookTitle,
      author: data.bookAuthor,
      genre: data.bookGenre,
      borrowedOn,
      dueDate,
      duration,
      userName: data.userFullName,
      userEmail: data.userEmail,
    };

    return {
      success: true,
      data: receipt,
    };
  } catch (error) {
    console.error("Error generating receipt:", error);
    return {
      success: false,
      error: "Failed to generate receipt",
    };
  }
};

export const getReceipt = async (borrowRecordId: string) => {
  try {
    // Fetch the borrow record with book and user details
    const record = await db
      .select({
        id: borrowRecords.id,
        borrowDate: borrowRecords.borrowDate,
        dueDate: borrowRecords.dueDate,
        bookTitle: books.title,
        bookAuthor: books.author,
        bookGenre: books.genre,
        userFullName: users.fullName,
        userEmail: users.email,
        borrowStatus: borrowRecords.borrowStatus,
      })
      .from(borrowRecords)
      .innerJoin(books, eq(borrowRecords.bookId, books.id))
      .innerJoin(users, eq(borrowRecords.userId, users.id))
      .where(eq(borrowRecords.id, borrowRecordId))
      .limit(1);

    if (!record.length) {
      return {
        success: false,
        error: "Borrow record not found",
      };
    }

    const data = record[0];

    // Format dates for receipt
    // If status is PENDING, we might want to show placeholders or actual request dates
    // For now, using the actual DB dates
    const issuedAt = dayjs(data.borrowDate).format("DD/MM/YYYY, hh:mm A");
    const borrowedOn = dayjs(data.borrowDate).format("DD/MM/YYYY");
    const dueDate = dayjs(data.dueDate).format("DD/MM/YYYY");

    // Calculate duration (just an example, or could be fixed 14 days)
    const duration = "14 Days";

    const receipt = {
      receiptId: data.id.substring(0, 8).toUpperCase(), // Short ID for display
      issuedAt,
      title: data.bookTitle,
      author: data.bookAuthor,
      genre: data.bookGenre,
      borrowedOn,
      dueDate,
      duration,
      userName: data.userFullName,
      userEmail: data.userEmail,
    };

    return {
      success: true,
      data: receipt,
    };
  } catch (error) {
    console.error("Error fetching receipt:", error);
    return {
      success: false,
      error: "Failed to fetch receipt",
    };
  }
};
