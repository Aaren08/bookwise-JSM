"use server";

import { eq } from "drizzle-orm";
import { db } from "@/database/drizzle";
import { books } from "@/database/schema";

export const createBook = async (params: BookParams) => {
  try {
    const newBook = await db
      .insert(books)
      .values({
        ...params,
        availableCopies: params.totalCopies,
      })
      .returning();

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
  params: Partial<BookParams> & { id: string }
) => {
  try {
    const updatedBook = await db
      .update(books)
      .set(params)
      .where(eq(books.id, params.id))
      .returning();

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
