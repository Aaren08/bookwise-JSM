"use server";

import { db } from "@/database/drizzle";
import { users, borrowRecords } from "@/database/schema";
import { eq, desc, count, and, or, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { broadcastAdminDashboardUpdate } from "@/lib/admin/realtime/dashboardSocketServer";
import { CACHE_TAGS } from "@/lib/performance/cache";
import {
  CONFLICT_ERROR_MESSAGE,
  assertLockOwnership,
  publishEvent,
  releaseLock,
  requireAdminActor,
  updateWithVersionCheck,
} from "@/lib/admin/realtime/concurrency/rowConcurrency";

const approvedUserSelect = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  userAvatar: users.userAvatar,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  role: users.role,
  universityId: users.universityId,
  universityCard: users.universityCard,
  status: users.status,
  version: users.version,
  booksBorrowed: count(borrowRecords.id),
};

export const getApprovedUserById = async (userId: string) => {
  const [user] = await db
    .select(approvedUserSelect)
    .from(users)
    .leftJoin(
      borrowRecords,
      and(
        eq(borrowRecords.userId, users.id),
        eq(borrowRecords.borrowStatus, "BORROWED"),
      ),
    )
    .where(and(eq(users.id, userId), eq(users.status, "APPROVED")))
    .groupBy(users.id)
    .limit(1);

  return user ? (JSON.parse(JSON.stringify(user)) as User) : null;
};

export const getPendingUserById = async (userId: string) => {
  const [user] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      userAvatar: users.userAvatar,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      universityId: users.universityId,
      universityCard: users.universityCard,
      status: users.status,
      version: users.version,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "PENDING")))
    .limit(1);

  return user ? (JSON.parse(JSON.stringify(user)) as PendingUser) : null;
};

export const getApprovedUsers = async ({
  page = 1,
  limit = 20,
}: {
  page?: number;
  limit?: number;
} = {}) => {
  try {
    const offset = (page - 1) * limit;

    const [{ value: totalUsers }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, "APPROVED"));

    const totalPages = Math.ceil(totalUsers / limit);

    const allUsers = await db
      .select(approvedUserSelect)
      .from(users)
      .leftJoin(
        borrowRecords,
        and(
          eq(borrowRecords.userId, users.id),
          eq(borrowRecords.borrowStatus, "BORROWED"),
        ),
      )
      .where(eq(users.status, "APPROVED"))
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

    const [{ value: totalPendingUsers }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, "PENDING"));

    const totalPages = Math.ceil(totalPendingUsers / limit);

    const pendingUsers = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        userAvatar: users.userAvatar,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        universityId: users.universityId,
        universityCard: users.universityCard,
        status: users.status,
        version: users.version,
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

export const approveAccount = async ({
  userId,
  expectedVersion,
  lockToken,
}: {
  userId: string;
  expectedVersion: number;
  lockToken?: string;
}) => {
  try {
    const admin = await requireAdminActor();
    await assertLockOwnership("account_requests", userId, admin.id, lockToken);

    const pendingUser = await getPendingUserById(userId);
    if (!pendingUser) {
      return { success: false, error: "Account request no longer pending" };
    }

    await updateWithVersionCheck({
      table: users,
      idColumn: users.id,
      versionColumn: users.version,
      id: userId,
      expectedVersion,
      values: { status: "APPROVED" },
    });

    const approvedUser = await getApprovedUserById(userId);

    revalidatePath("/admin/account-requests");
    revalidatePath("/admin/users");
    revalidateTag(CACHE_TAGS.users, "max");
    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    await publishEvent("account_requests", {
      type: "DELETE",
      entityId: userId,
      data: null,
    });

    if (approvedUser) {
      await publishEvent("users", {
        type: "CREATE",
        entityId: userId,
        data: approvedUser,
      });
    }

    await releaseLock("account_requests", userId, admin.id, lockToken);

    return {
      success: true,
      message: "Account approved successfully",
      data: approvedUser,
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to approve account",
    };
  }
};

export const rejectAccount = async ({
  userId,
  expectedVersion,
  lockToken,
}: {
  userId: string;
  expectedVersion: number;
  lockToken?: string;
}) => {
  try {
    const admin = await requireAdminActor();
    await assertLockOwnership("account_requests", userId, admin.id, lockToken);

    const pendingUser = await getPendingUserById(userId);
    if (!pendingUser) {
      return { success: false, error: "Account request no longer pending" };
    }

    await updateWithVersionCheck({
      table: users,
      idColumn: users.id,
      versionColumn: users.version,
      id: userId,
      expectedVersion,
      values: { status: "REJECTED" },
    });

    revalidatePath("/admin/account-requests");
    revalidateTag(CACHE_TAGS.users, "max");
    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    await publishEvent("account_requests", {
      type: "DELETE",
      entityId: userId,
      data: null,
    });

    await releaseLock("account_requests", userId, admin.id, lockToken);

    return {
      success: true,
      message: "Account rejected successfully",
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to reject account",
    };
  }
};

export const deleteUser = async ({
  userId,
  expectedVersion,
  lockToken,
}: {
  userId: string;
  expectedVersion: number;
  lockToken?: string;
}) => {
  try {
    const admin = await requireAdminActor();
    await assertLockOwnership("users", userId, admin.id, lockToken);

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

    const deletedUserCTE = db.$with("deletedUser").as(
      db
        .delete(users)
        .where(and(eq(users.id, userId), eq(users.version, expectedVersion)))
        .returning(),
    );

    const deletedRecordsCTE = db.$with("deletedRecords").as(
      db
        .delete(borrowRecords)
        .where(
          and(
            eq(borrowRecords.userId, userId),
            sql`EXISTS (SELECT 1 FROM ${deletedUserCTE})`,
          ),
        )
        .returning({ id: borrowRecords.id }),
    );

    const deletedUser = await db
      .with(deletedUserCTE, deletedRecordsCTE)
      .select()
      .from(deletedUserCTE);

    if (!deletedUser[0]) {
      return {
        success: false,
        error: CONFLICT_ERROR_MESSAGE,
      };
    }

    revalidatePath("/admin/users");
    revalidateTag(CACHE_TAGS.users, "max");
    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    await publishEvent("users", {
      type: "DELETE",
      entityId: userId,
      data: null,
    });

    await releaseLock("users", userId, admin.id, lockToken);

    return {
      success: true,
      message: "User deleted successfully",
      data: JSON.parse(JSON.stringify(deletedUser[0])) as User,
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete user",
    };
  }
};

export const updateUserRole = async ({
  userId,
  role,
  expectedVersion,
  lockToken,
}: {
  userId: string;
  role: "USER" | "ADMIN";
  expectedVersion: number;
  lockToken?: string;
}) => {
  try {
    const admin = await requireAdminActor();
    await assertLockOwnership("users", userId, admin.id, lockToken);

    await updateWithVersionCheck({
      table: users,
      idColumn: users.id,
      versionColumn: users.version,
      id: userId,
      expectedVersion,
      values: { role },
    });

    const updatedUser = await getApprovedUserById(userId);

    revalidatePath("/admin/users");
    revalidateTag(CACHE_TAGS.users, "max");
    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    if (updatedUser) {
      await publishEvent("users", {
        type: "UPDATE",
        entityId: userId,
        data: updatedUser,
      });
    }

    await releaseLock("users", userId, admin.id, lockToken);

    return {
      success: true,
      message: "User role updated successfully",
      data: updatedUser,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message === CONFLICT_ERROR_MESSAGE
            ? CONFLICT_ERROR_MESSAGE
            : error.message
          : "Failed to update user role",
    };
  }
};
