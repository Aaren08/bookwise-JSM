import { unstable_cache } from "next/cache";
import { and, asc, desc, eq, ilike, ne, or, sql, inArray } from "drizzle-orm";
import { db } from "@/database/drizzle";
import { books, borrowRecords, users } from "@/database/schema";
import type { SearchOptions, SearchResult } from "@/lib/essentials/searchQuery";

export const CACHE_TAGS = {
  books: "books",
  users: "users",
} as const;

export const CACHE_REVALIDATE = {
  books: 300,
  search: 120,
  userState: 60,
} as const;

export const getLatestBooksCached = (limit: number) =>
  unstable_cache(
    async () =>
      (await db
        .select()
        .from(books)
        .limit(limit)
        .orderBy(desc(books.createdAt))) as Book[],
    ["latest-books", String(limit)],
    {
      revalidate: CACHE_REVALIDATE.books,
      tags: [CACHE_TAGS.books],
    },
  )();

export const getBookByIdCached = (bookId: string) =>
  unstable_cache(
    async () =>
      (await db.select().from(books).where(eq(books.id, bookId)).limit(1))[0] ??
      null,
    ["book-by-id", bookId],
    {
      revalidate: CACHE_REVALIDATE.books,
      tags: [CACHE_TAGS.books],
    },
  )();

export const getSimilarBooksCached = (bookId: string) =>
  unstable_cache(
    async () =>
      (await db
        .select()
        .from(books)
        .where(
          and(
            eq(
              books.genre,
              db
                .select({ genre: books.genre })
                .from(books)
                .where(eq(books.id, bookId)),
            ),
            ne(books.id, bookId),
          ),
        )
        .limit(6)) as Book[],
    ["similar-books", bookId],
    {
      revalidate: CACHE_REVALIDATE.books,
      tags: [CACHE_TAGS.books],
    },
  )();

export type BorrowingEligibility = {
  isEligible: boolean;
  message: string;
};

export const getBorrowingEligibilityCached = (userId: string, bookId: string) =>
  unstable_cache(
    async () => {
      const [user] = await db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) return null;

      const [book] = await db
        .select({ availableCopies: books.availableCopies })
        .from(books)
        .where(eq(books.id, bookId))
        .limit(1);

      if (!book) return null;

      const [borrowing] = await db
        .select({ id: borrowRecords.id })
        .from(borrowRecords)
        .where(
          and(
            eq(borrowRecords.userId, userId),
            eq(borrowRecords.bookId, bookId),
            inArray(borrowRecords.borrowStatus, ["BORROWED", "PENDING"]),
          ),
        )
        .limit(1);

      return {
        isEligible:
          book.availableCopies > 0 && user.status === "APPROVED" && !borrowing,
        message:
          book.availableCopies <= 0
            ? "Book is not available at the moment. Please check back later."
            : borrowing
              ? "You have already borrowed or requested this book."
              : user.status !== "APPROVED"
                ? "You are not eligible to borrow this book. Please contact the library for more information."
                : "You are eligible to borrow this book.",
      } satisfies BorrowingEligibility;
    },
    ["borrowing-eligibility", userId, bookId],
    {
      revalidate: CACHE_REVALIDATE.userState,
      tags: [CACHE_TAGS.books, CACHE_TAGS.users],
    },
  )();

const runBookSearch = async ({
  query,
  filter,
  page,
  limit,
}: SearchOptions): Promise<SearchResult> => {
  const offset = (page - 1) * limit;

  if (!query.trim()) {
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(books);

    const totalCount = Number(countResult[0]?.count || 0);

    const bookResults = (await db
      .select()
      .from(books)
      .orderBy(asc(books.title))
      .limit(limit)
      .offset(offset)) as Book[];

    return {
      books: bookResults,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  const baseSearchCondition = or(
    ilike(books.title, `%${query}%`),
    ilike(books.author, `%${query}%`),
    ilike(books.genre, `%${query}%`),
  );

  let whereCondition;
  let orderByClause;

  switch (filter) {
    case "author":
      whereCondition = baseSearchCondition;
      orderByClause = [asc(books.author), asc(books.title)];
      break;
    case "genre":
      whereCondition = baseSearchCondition;
      orderByClause = [asc(books.genre), asc(books.author), asc(books.title)];
      break;
    case "rating":
      whereCondition = baseSearchCondition;
      orderByClause = [desc(books.rating), asc(books.title)];
      break;
    case "availability":
      whereCondition = sql`(
        ${ilike(books.title, `%${query}%`)} OR
        ${ilike(books.author, `%${query}%`)} OR
        ${ilike(books.genre, `%${query}%`)}
      ) AND ${books.availableCopies} > 0`;
      orderByClause = [desc(books.availableCopies), asc(books.title)];
      break;
    default:
      whereCondition = baseSearchCondition;
      orderByClause = [asc(books.author), asc(books.title)];
  }

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(whereCondition);

  const totalCount = Number(countResult[0]?.count || 0);

  const bookResults = (await db
    .select()
    .from(books)
    .where(whereCondition)
    .orderBy(...orderByClause)
    .limit(limit)
    .offset(offset)) as Book[];

  return {
    books: bookResults,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
  };
};

export const searchBooksCached = (options: SearchOptions) =>
  unstable_cache(
    async () => runBookSearch(options),
    [
      "search-books",
      options.query.trim().toLowerCase(),
      options.filter,
      String(options.page),
      String(options.limit),
    ],
    {
      revalidate: CACHE_REVALIDATE.search,
      tags: [CACHE_TAGS.books],
    },
  )();
