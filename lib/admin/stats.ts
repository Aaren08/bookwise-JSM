"use server";

import { cache } from "react";
import { db } from "@/database/drizzle";
import { books, users, borrowRecords } from "@/database/schema";
import { count, eq } from "drizzle-orm";
import { getDashboardData } from "@/lib/admin/dashboard";

export const getDashboardStats = cache(async () => {
  try {
    const [{ value: totalBooks }] = await db
      .select({ value: count() })
      .from(books);

    const [{ value: totalUsers }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, "APPROVED"));

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
      data: { totalBooks: 0, totalUsers: 0, borrowedBooks: 0 },
    };
  }
});

export const getAdminDashboardSnapshot = cache(async () => {
  const [statsResult, dashboardResult] = await Promise.all([
    getDashboardStats(),
    getDashboardData(),
  ]);

  return {
    success: statsResult.success && dashboardResult.success,
    data: {
      stats: statsResult.data,
      latestBorrowRequests: dashboardResult.data.latestBorrowRequests,
      latestAccountRequests: dashboardResult.data.latestAccountRequests,
      recentBooks: dashboardResult.data.recentBooks,
    },
  };
});
