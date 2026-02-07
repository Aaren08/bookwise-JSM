"use server";

import { db } from "@/database/drizzle";
import { books, users, borrowRecords } from "@/database/schema";
import { eq, desc } from "drizzle-orm";

export const getDashboardData = async () => {
  try {
    // Get latest pending borrow requests
    const latestBorrowRequests = await db
      .select({
        id: borrowRecords.id,
        borrowDate: borrowRecords.borrowDate,
        status: borrowRecords.borrowStatus,
        bookTitle: books.title,
        bookCover: books.coverUrl,
        bookGenre: books.genre,
        bookAuthor: books.author,
        coverColor: books.coverColor,
        userFullName: users.fullName,
        userAvatar: users.userAvatar,
      })
      .from(borrowRecords)
      .innerJoin(books, eq(borrowRecords.bookId, books.id))
      .innerJoin(users, eq(borrowRecords.userId, users.id))
      .where(eq(borrowRecords.borrowStatus, "PENDING"))
      .orderBy(desc(borrowRecords.borrowDate))
      .limit(5);

    // Get latest account requests
    const { id, userAvatar, fullName, email } = users;
    const latestAccountRequests = await db
      .select({
        id,
        userAvatar,
        fullName,
        email,
      })
      .from(users)
      .where(eq(users.status, "PENDING"))
      .orderBy(desc(users.createdAt))
      .limit(9);

    // Get recent books added
    const recentBooks = await db
      .select({
        id: books.id,
        bookTitle: books.title,
        bookAuthor: books.author,
        bookGenre: books.genre,
        bookCover: books.coverUrl,
        coverColor: books.coverColor,
        createdAt: books.createdAt,
      })
      .from(books)
      .orderBy(desc(books.createdAt))
      .limit(8);

    return {
      success: true,
      data: {
        latestBorrowRequests: JSON.parse(JSON.stringify(latestBorrowRequests)),
        latestAccountRequests: JSON.parse(
          JSON.stringify(latestAccountRequests),
        ),
        recentBooks: JSON.parse(JSON.stringify(recentBooks)),
      },
    };
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    return {
      success: false,
      message: "Failed to fetch dashboard statistics",
      data: {
        latestBorrowRequests: [],
        latestAccountRequests: [],
        recentBooks: [],
      },
    };
  }
};
