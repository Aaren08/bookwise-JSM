"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq, desc, count, ilike, or, and } from "drizzle-orm";
import { db } from "@/database/drizzle";
import { books, borrowRecords } from "@/database/schema";
import { broadcastAdminDashboardUpdate } from "@/lib/admin/realtime/dashboardSocketServer";
import { CACHE_TAGS } from "@/lib/performance/cache";

export const createBook = async (params: BookParams) => {
  try {
    const newBook = await db.insert(books).values(params).returning();

    revalidateTag(CACHE_TAGS.books, "max");


    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    return {
      success: true,
      message: "Book created successfully",
      data: JSON.parse(JSON.stringify(newBook[0])),
    };
  } catch (error) {
    console.log(error);

    return {
      success: false,
      message: "Failed to create book",
    };
  }
};

export const updateBook = async (
  params: Partial<BookParams> & { id: string },
) => {
  try {
    const { id, ...data } = params;
    const updateData: Partial<Book> = { ...data };

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

    const updatedBook = await db
      .update(books)
      .set(updateData)
      .where(eq(books.id, id))
      .returning();

    revalidateTag(CACHE_TAGS.books, "max");


    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    return {
      success: true,
      message: "Book updated successfully",
      data: JSON.parse(JSON.stringify(updatedBook[0])),
    };
  } catch (error) {
    console.log(error);

    return {
      success: false,
      message: "Failed to update book",
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

export const deleteBook = async (id: string) => {
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
      .where(eq(books.id, id))
      .returning();

    revalidatePath("/admin/books");
    revalidateTag(CACHE_TAGS.books, "max");
    broadcastAdminDashboardUpdate().catch((err) =>
      console.error("broadcastAdminDashboardUpdate failed", err),
    );

    return {
      success: true,
      message: "Book deleted successfully",
      data: JSON.parse(JSON.stringify(deletedBook[0])),
    };
  } catch (error) {
    console.log(error);

    return {
      success: false,
      message: "Failed to delete book",
    };
  }
};
