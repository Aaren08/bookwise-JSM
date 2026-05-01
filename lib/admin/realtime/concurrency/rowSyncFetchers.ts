import "server-only";

import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import { and, count, desc, eq, inArray } from "drizzle-orm";

const SYNC_DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// borrow_requests
// ---------------------------------------------------------------------------

export const getBorrowRecordsForSync = async (
  ids?: string[],
  limit = SYNC_DEFAULT_LIMIT,
): Promise<BorrowRecord[]> => {
  const baseQuery = db
    .select({
      id: borrowRecords.id,
      borrowDate: borrowRecords.borrowDate,
      dueDate: borrowRecords.dueDate,
      returnDate: borrowRecords.returnDate,
      status: borrowRecords.borrowStatus,
      updatedAt: borrowRecords.updatedAt,
      version: borrowRecords.version,
      bookTitle: books.title,
      bookCover: books.coverUrl,
      bookGenre: books.genre,
      userFullName: users.fullName,
      userEmail: users.email,
      userAvatar: users.userAvatar,
    })
    .from(borrowRecords)
    .innerJoin(books, eq(borrowRecords.bookId, books.id))
    .innerJoin(users, eq(borrowRecords.userId, users.id));

  const rows =
    ids && ids.length > 0
      ? await baseQuery.where(inArray(borrowRecords.id, ids))
      : await baseQuery.orderBy(desc(borrowRecords.borrowDate)).limit(limit);

  return JSON.parse(JSON.stringify(rows)) as BorrowRecord[];
};

// ---------------------------------------------------------------------------
// account_requests  (pending users only)
// ---------------------------------------------------------------------------

export const getPendingUsersForSync = async (
  ids?: string[],
  limit = SYNC_DEFAULT_LIMIT,
): Promise<PendingUser[]> => {
  const baseQuery = db
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
    .where(
      ids && ids.length > 0
        ? and(inArray(users.id, ids), eq(users.status, "PENDING"))
        : eq(users.status, "PENDING"),
    );

  const rows =
    ids && ids.length > 0
      ? await baseQuery
      : await baseQuery.orderBy(desc(users.createdAt)).limit(limit);

  return JSON.parse(JSON.stringify(rows)) as PendingUser[];
};

// ---------------------------------------------------------------------------
// users  (approved users with borrow count)
// ---------------------------------------------------------------------------

export const getApprovedUsersForSync = async (
  ids?: string[],
  limit = SYNC_DEFAULT_LIMIT,
): Promise<User[]> => {
  const baseQuery = db
    .select({
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
    })
    .from(users)
    .leftJoin(
      borrowRecords,
      and(
        eq(borrowRecords.userId, users.id),
        eq(borrowRecords.borrowStatus, "BORROWED"),
      ),
    )
    .where(
      ids && ids.length > 0
        ? and(inArray(users.id, ids), eq(users.status, "APPROVED"))
        : eq(users.status, "APPROVED"),
    )
    .groupBy(users.id);

  const rows =
    ids && ids.length > 0
      ? await baseQuery
      : await baseQuery.orderBy(desc(users.createdAt)).limit(limit);

  return JSON.parse(JSON.stringify(rows)) as User[];
};

// ---------------------------------------------------------------------------
// books
// ---------------------------------------------------------------------------

export const getBooksForSync = async (
  ids?: string[],
  limit = SYNC_DEFAULT_LIMIT,
): Promise<Book[]> => {
  const rows =
    ids && ids.length > 0
      ? await db.select().from(books).where(inArray(books.id, ids))
      : await db
          .select()
          .from(books)
          .orderBy(desc(books.createdAt))
          .limit(limit);

  return JSON.parse(JSON.stringify(rows)) as Book[];
};
