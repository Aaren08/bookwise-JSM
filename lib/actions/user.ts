"use server";

import { eq } from "drizzle-orm";
import { db } from "@/database/drizzle";
import { users, borrowRecords, books } from "@/database/schema";
import { auth } from "@/auth";
import { and, count, desc } from "drizzle-orm";
import { getApprovedUserById } from "@/lib/admin/actions/user";
import { publishEvent } from "@/lib/admin/realtime/concurrency/rowConcurrency";

export const getUserBorrowedBooks = async (
  userId: string,
  page: number = 1,
  limit: number = 6,
) => {
  try {
    const session = await auth();
    if (
      !session?.user?.id ||
      (session.user.id !== userId && session.user.role !== "ADMIN")
    ) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    const offset = (page - 1) * limit;

    // Get borrowed books with book details - all statuses except dismissed
    const { id, borrowDate, dueDate, returnDate, borrowStatus } = borrowRecords;

    // Fetch borrowed records and total count in parallel
    const [records, [{ value: total }]] = await Promise.all([
      db
        .select({
          id,
          borrowDate,
          dueDate,
          returnDate,
          borrowStatus,
          book: books,
        })
        .from(borrowRecords)
        .innerJoin(books, eq(borrowRecords.bookId, books.id))
        .where(
          and(eq(borrowRecords.userId, userId), eq(borrowRecords.dismissed, 0)),
        )
        .orderBy(desc(borrowRecords.borrowDate))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: count() })
        .from(borrowRecords)
        .where(
          and(eq(borrowRecords.userId, userId), eq(borrowRecords.dismissed, 0)),
        ),
    ]);

    const borrowedRecords = records;
    const totalPages = Math.ceil(total / limit);

    const borrowedBooks = borrowedRecords.map((record) => ({
      ...record.book,
      borrowRecordId: record.id,
      borrowDate: record.borrowDate!,
      dueDate: new Date(record.dueDate),
      returnDate: record.returnDate ? new Date(record.returnDate) : null,
      borrowStatus: record.borrowStatus,
    }));

    return {
      success: true,
      data: {
        books: JSON.parse(JSON.stringify(borrowedBooks)),
        pagination: {
          currentPage: page,
          totalPages,
          totalBooks: total,
          hasMore: page < totalPages,
        },
      },
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to fetch borrowed books",
    };
  }
};

export const getUserProfile = async (userId: string) => {
  try {
    const session = await auth();
    if (
      !session?.user?.id ||
      (session.user.id !== userId && session.user.role !== "ADMIN")
    ) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    const {
      id,
      fullName,
      email,
      universityId,
      universityCard,
      userAvatar,
      status,
      role,
    } = users;
    const user = await db
      .select({
        id,
        fullName,
        email,
        universityId,
        universityCard,
        userAvatar,
        status,
        role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user.length) {
      return {
        success: false,
        error: "User not found",
      };
    }

    return {
      success: true,
      data: JSON.parse(JSON.stringify(user[0])),
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to fetch user profile",
    };
  }
};

export const updateUserImage = async (userId: string, imageUrl: string) => {
  try {
    const session = await auth();
    if (
      !session?.user?.id ||
      (session.user.id !== userId && session.user.role !== "ADMIN")
    ) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    await db
      .update(users)
      .set({ userAvatar: imageUrl, updatedAt: new Date() })
      .where(eq(users.id, userId));

    try {
      const approvedUser = await getApprovedUserById(userId);
      if (approvedUser) {
        await publishEvent("users", {
          type: "UPDATE",
          entityId: userId,
          data: approvedUser,
        });
      }
    } catch (realtimeError) {
      console.error(
        `Failed to publish realtime update for user ${userId}:`,
        realtimeError,
      );
    }

    return {
      success: true,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to update user image",
    };
  }
};
