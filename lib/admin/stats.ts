"use server";

import { db } from "@/database/drizzle";
import { books, users, borrowRecords } from "@/database/schema";
import { count, eq } from "drizzle-orm";

export const getDashboardStats = async () => {
  try {
    // Get total books count
    const [{ value: totalBooks }] = await db
      .select({ value: count() })
      .from(books);

    // Get total approved users count
    const [{ value: totalUsers }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, "APPROVED"));

    // Get currently borrowed books count
    const [{ value: borrowedBooks }] = await db
      .select({ value: count() })
      .from(borrowRecords)
      .where(eq(borrowRecords.borrowStatus, "BORROWED"));

    return {
      success: true,
      data: {
        totalBooks: Number(totalBooks),
        totalUsers: Number(totalUsers),
        borrowedBooks: Number(borrowedBooks),
      },
    };
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    return {
      success: false,
      message: "Failed to fetch dashboard statistics",
      data: {
        totalBooks: 0,
        totalUsers: 0,
        borrowedBooks: 0,
      },
    };
  }
};
