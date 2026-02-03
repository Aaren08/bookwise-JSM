"use server";

import { db } from "@/database/drizzle";
import { users, borrowRecords } from "@/database/schema";
import { eq, desc, count, and, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export const getAllUsers = async ({
  page = 1,
  limit = 20,
}: {
  page?: number;
  limit?: number;
} = {}) => {
  try {
    const offset = (page - 1) * limit;

    // Get total count of users
    const [{ value: totalUsers }] = await db
      .select({ value: count() })
      .from(users);

    const totalPages = Math.ceil(totalUsers / limit);

    // Get paginated users with borrowed books count
    const {
      id,
      fullName,
      email,
      userAvatar,
      createdAt,
      role,
      universityId,
      universityCard,
    } = users;
    const allUsers = await db
      .select({
        id,
        fullName,
        email,
        userAvatar,
        createdAt,
        role,
        universityId,
        universityCard,
        booksBorrowed: count(borrowRecords.id),
      })
      .from(users)
      .leftJoin(
        borrowRecords,
        and(
          eq(borrowRecords.userId, users.id),
          eq(borrowRecords.borrowStatus, "BORROWED"),
        ),
      )
      .groupBy(users.id)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: {
        users: JSON.parse(JSON.stringify(allUsers)),
        totalPages,
      },
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to fetch users",
    };
  }
};

export const getPendingUsers = async ({
  page = 1,
  limit = 20,
}: {
  page?: number;
  limit?: number;
} = {}) => {
  try {
    const offset = (page - 1) * limit;

    // Get total count of pending users
    const [{ value: totalPendingUsers }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, "PENDING"));

    const totalPages = Math.ceil(totalPendingUsers / limit);

    const {
      id,
      fullName,
      email,
      userAvatar,
      createdAt,
      universityId,
      universityCard,
    } = users;

    const pendingUsers = await db
      .select({
        id,
        fullName,
        email,
        userAvatar,
        createdAt,
        universityId,
        universityCard,
        status: users.status,
      })
      .from(users)
      .where(eq(users.status, "PENDING"))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: {
        users: JSON.parse(JSON.stringify(pendingUsers)),
        totalPages,
      },
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to fetch pending users",
    };
  }
};

export const approveAccount = async (userId: string) => {
  try {
    await db
      .update(users)
      .set({ status: "APPROVED" })
      .where(eq(users.id, userId));

    revalidatePath("/admin/accounts");

    return {
      success: true,
      message: "Account approved successfully",
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: "Failed to approve account",
    };
  }
};

export const rejectAccount = async (userId: string) => {
  try {
    await db
      .update(users)
      .set({ status: "REJECTED" })
      .where(eq(users.id, userId));

    revalidatePath("/admin/accounts");

    return {
      success: true,
      message: "Account rejected successfully",
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: "Failed to reject account",
    };
  }
};

export const deleteUser = async (userId: string) => {
  try {
    // Check if user has any active loans (BORROWED or LATE_RETURN)
    const activeBorrowRecords = await db
      .select()
      .from(borrowRecords)
      .where(
        and(
          eq(borrowRecords.userId, userId),
          or(
            eq(borrowRecords.borrowStatus, "BORROWED"),
            eq(borrowRecords.borrowStatus, "LATE_RETURN"),
          ),
        ),
      )
      .limit(1);

    if (activeBorrowRecords.length > 0) {
      return {
        success: false,
        error:
          "Cannot delete user with active borrow records (Borrowed or Late Return)",
      };
    }

    // Delete all borrow records for this user (history cleanup)
    await db.delete(borrowRecords).where(eq(borrowRecords.userId, userId));

    // Delete the user
    await db.delete(users).where(eq(users.id, userId));

    revalidatePath("/admin/users");

    return {
      success: true,
      message: "User deleted successfully",
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: "Failed to delete user",
    };
  }
};

export const updateUserRole = async (
  userId: string,
  role: "USER" | "ADMIN",
) => {
  try {
    await db.update(users).set({ role }).where(eq(users.id, userId));

    revalidatePath("/admin/users");

    return {
      success: true,
      message: "User role updated successfully",
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Failed to update user role",
    };
  }
};
