"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq, desc, count, ilike, or, and } from "drizzle-orm";
import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
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

type UpdateBookParams = Partial<BookParams> & {
  id: string;
  expectedVersion: number;
  lockToken?: string;
};

type DeleteBookParams = {
  id: string;
  expectedVersion: number;
  lockToken?: string;
};

export const getBookById = async (id: string) => {
  const [book] = await db.select().from(books).where(eq(books.id, id)).limit(1);
  return book ? (JSON.parse(JSON.stringify(book)) as Book) : null;
};

export const createBook = async (params: BookParams) => {
  try {
    await requireAdminActor();
    const newBook = await db
      .insert(books)
      .values({
        ...params,
        updatedAt: new Date(),
      })
      .returning();

    revalidateTag(CACHE_TAGS.books, "max");

    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    const payload = JSON.parse(JSON.stringify(newBook[0])) as Book;
    try {
      await publishEvent("books", {
        type: "CREATE",
        entityId: payload.id,
        data: payload,
      });
    } catch (realtimeError) {
      console.error(
        `Failed to publish realtime CREATE event for book ${payload.id}:`,
        realtimeError,
      );
    }

    return {
      success: true,
      message: "Book created successfully",
      data: payload,
    };
  } catch (error) {
    console.log(error);

    return {
      success: false,
      message: "Failed to create book",
    };
  }
};

export const updateBook = async (params: UpdateBookParams) => {
  try {
    const admin = await requireAdminActor();
    const { id, expectedVersion, lockToken, ...data } = params;

    await assertLockOwnership("books", id, admin.id, lockToken);

    try {
      if (params.totalCopies !== undefined) {
        const [borrowedCountResult] = await db
          .select({ value: count() })
          .from(borrowRecords)
          .where(
            and(
              eq(borrowRecords.bookId, id),
              eq(borrowRecords.borrowStatus, "BORROWED"),
            ),
          );

        const borrowedCount = Number(borrowedCountResult.value);
        const newAvailableCopies = params.totalCopies - borrowedCount;

        if (newAvailableCopies < 0) {
          return {
            success: false,
            message: `Cannot reduce total copies below ${borrowedCount} (currently borrowed)`,
          };
        }
      }

      await updateWithVersionCheck({
        table: books,
        idColumn: books.id,
        versionColumn: books.version,
        id,
        expectedVersion,
        values: data,
      });

      const updatedBook = await getBookById(id);

      revalidateTag(CACHE_TAGS.books, "max");

      broadcastAdminDashboardUpdate().catch((err) =>
        console.error("broadcastAdminDashboardUpdate failed", err),
      );

      if (updatedBook) {
        try {
          await publishEvent("books", {
            type: "UPDATE",
            entityId: id,
            data: updatedBook,
          });
        } catch (realtimeError) {
          console.error(
            `Failed to publish realtime UPDATE event for book ${id}:`,
            realtimeError,
          );
        }
      }

      return {
        success: true,
        message: "Book updated successfully",
        data: updatedBook,
      };
    } finally {
      try {
        await releaseLock("books", id, admin.id, lockToken);
      } catch (error) {
        console.error("Failed to release lock for updateBook", {
          id,
          adminId: admin.id,
          hasLock: !!lockToken,
          error,
        });
      }
    }
  } catch (error) {
    console.log(error);

    return {
      success: false,
      message:
        error instanceof Error
          ? error.message === CONFLICT_ERROR_MESSAGE
            ? CONFLICT_ERROR_MESSAGE
            : error.message
          : "Failed to update book",
    };
  }
};

export const getAllBooks = async ({
  limit = 20,
  page = 1,
  query,
}: {
  limit?: number;
  page?: number;
  query?: string;
}) => {
  try {
    const offset = (page - 1) * limit;

    const searchCondition = query
      ? or(ilike(books.title, `%${query}%`), ilike(books.author, `%${query}%`))
      : undefined;

    const booksQuery = db
      .select()
      .from(books)
      .where(searchCondition)
      .orderBy(desc(books.createdAt))
      .limit(limit)
      .offset(offset);

    const [allBooks, [{ value: totalBooks }]] = await Promise.all([
      booksQuery,
      db.select({ value: count() }).from(books).where(searchCondition),
    ]);

    const totalPages = Math.ceil(totalBooks / limit);

    return {
      success: true,
      data: {
        books: JSON.parse(JSON.stringify(allBooks)),
        totalPages,
      },
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      message: "Failed to fetch books",
    };
  }
};

export const deleteBook = async ({
  id,
  expectedVersion,
  lockToken,
}: DeleteBookParams) => {
  try {
    const admin = await requireAdminActor();

    await assertLockOwnership("books", id, admin.id, lockToken);

    try {
      const bookBorrowRecords = await db
        .select()
        .from(borrowRecords)
        .where(eq(borrowRecords.bookId, id))
        .limit(1);

      if (bookBorrowRecords.length > 0) {
        return {
          success: false,
          message: "Cannot delete book with existing borrow records",
        };
      }

      const deletedBook = await db
        .delete(books)
        .where(and(eq(books.id, id), eq(books.version, expectedVersion)))
        .returning();

      if (!deletedBook[0]) {
        return {
          success: false,
          message: CONFLICT_ERROR_MESSAGE,
        };
      }

      revalidatePath("/admin/books");
      revalidateTag(CACHE_TAGS.books, "max");
      broadcastAdminDashboardUpdate().catch((err) =>
        console.error("broadcastAdminDashboardUpdate failed", err),
      );

      try {
        await publishEvent("books", {
          type: "DELETE",
          entityId: id,
          data: null,
        });
      } catch (realtimeError) {
        console.error(
          `Failed to publish realtime DELETE event for book ${id}:`,
          realtimeError,
        );
      }

      return {
        success: true,
        message: "Book deleted successfully",
        data: JSON.parse(JSON.stringify(deletedBook[0])) as Book,
      };
    } finally {
      try {
        await releaseLock("books", id, admin.id, lockToken);
      } catch (error) {
        console.error("Failed to release lock for deleteBook", {
          id,
          adminId: admin.id,
          hasLock: !!lockToken,
          error,
        });
      }
    }
  } catch (error) {
    console.log(error);

    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to delete book",
    };
  }
};
