import { db } from "@/database/drizzle";
import { books } from "@/database/schema";
import { ilike, or, sql, desc, asc } from "drizzle-orm";

export interface SearchOptions {
  query: string;
  filter: "author" | "genre" | "rating" | "availability";
  page: number;
  limit: number;
}

export interface SearchResult {
  books: Book[];
  totalCount: number;
  totalPages: number;
}

/**
 * Search books based on title, author, or genre with fuzzy matching
 */
export async function searchBooks(
  options: SearchOptions
): Promise<SearchResult> {
  const { query, filter, page, limit } = options;
  const offset = (page - 1) * limit;

  // If no query, return all books
  if (!query.trim()) {
    return getAllBooks(page, limit);
  }

  // Always search across title, author, and genre
  const baseSearchCondition = or(
    ilike(books.title, `%${query}%`),
    ilike(books.author, `%${query}%`),
    ilike(books.genre, `%${query}%`)
  );

  let whereCondition;
  let orderByClause;

  // Filter only affects sorting and additional constraints (like availability)
  switch (filter) {
    case "author":
      // Search all fields, sort by author
      whereCondition = baseSearchCondition;
      orderByClause = [asc(books.author), asc(books.title)];
      break;

    case "genre":
      // Search all fields, sort by genre then author
      whereCondition = baseSearchCondition;
      orderByClause = [asc(books.genre), asc(books.author), asc(books.title)];
      break;

    case "rating":
      // Search all fields, sort by rating
      whereCondition = baseSearchCondition;
      orderByClause = [desc(books.rating), asc(books.title)];
      break;

    case "availability":
      // Search all fields, but only show available books
      whereCondition = sql`(
        ${ilike(books.title, `%${query}%`)} OR
        ${ilike(books.author, `%${query}%`)} OR
        ${ilike(books.genre, `%${query}%`)}
      ) AND ${books.availableCopies} > 0`;
      orderByClause = [desc(books.availableCopies), asc(books.title)];
      break;

    default:
      // Default: search all fields, sort by author
      whereCondition = baseSearchCondition;
      orderByClause = [asc(books.author), asc(books.title)];
  }

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(whereCondition);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get paginated results with ordering
  const bookResults = (await db
    .select()
    .from(books)
    .where(whereCondition)
    .orderBy(...orderByClause)
    .limit(limit)
    .offset(offset)) as Book[];

  const totalPages = Math.ceil(totalCount / limit);

  return {
    books: bookResults,
    totalCount,
    totalPages,
  };
}

/**
 * Get all books with pagination (when no search query)
 */
async function getAllBooks(page: number, limit: number): Promise<SearchResult> {
  const offset = (page - 1) * limit;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get paginated results ordered by title
  const bookResults = (await db
    .select()
    .from(books)
    .orderBy(asc(books.title))
    .limit(limit)
    .offset(offset)) as Book[];

  const totalPages = Math.ceil(totalCount / limit);

  return {
    books: bookResults,
    totalCount,
    totalPages,
  };
}

/**
 * Search books by title specifically (fuzzy matching)
 */
export async function searchByTitle(
  title: string,
  page: number,
  limit: number
): Promise<SearchResult> {
  const offset = (page - 1) * limit;

  // Search with fuzzy matching - matches any part of the title
  const whereCondition = ilike(books.title, `%${title}%`);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(whereCondition);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get results ordered by relevance (exact matches first, then partial)
  const bookResults = (await db
    .select()
    .from(books)
    .where(whereCondition)
    .orderBy(asc(books.title))
    .limit(limit)
    .offset(offset)) as Book[];

  const totalPages = Math.ceil(totalCount / limit);

  return {
    books: bookResults,
    totalCount,
    totalPages,
  };
}

/**
 * Search books by author (all books by that author)
 */
export async function searchByAuthor(
  author: string,
  page: number,
  limit: number
): Promise<SearchResult> {
  const offset = (page - 1) * limit;

  const whereCondition = ilike(books.author, `%${author}%`);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(whereCondition);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get results ordered alphabetically by author, then by title
  const bookResults = (await db
    .select()
    .from(books)
    .where(whereCondition)
    .orderBy(asc(books.author), asc(books.title))
    .limit(limit)
    .offset(offset)) as Book[];

  const totalPages = Math.ceil(totalCount / limit);

  return {
    books: bookResults,
    totalCount,
    totalPages,
  };
}

/**
 * Search books by genre
 */
export async function searchByGenre(
  genre: string,
  page: number,
  limit: number
): Promise<SearchResult> {
  const offset = (page - 1) * limit;

  const whereCondition = ilike(books.genre, `%${genre}%`);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(whereCondition);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get results ordered alphabetically by author
  const bookResults = (await db
    .select()
    .from(books)
    .where(whereCondition)
    .orderBy(asc(books.author), asc(books.title))
    .limit(limit)
    .offset(offset)) as Book[];

  const totalPages = Math.ceil(totalCount / limit);

  return {
    books: bookResults,
    totalCount,
    totalPages,
  };
}

/**
 * Get only available books (with copies > 0)
 */
export async function searchAvailableBooks(
  query: string,
  page: number,
  limit: number
): Promise<SearchResult> {
  const offset = (page - 1) * limit;

  // Search across all fields but only available books
  const whereCondition = sql`(
    ${ilike(books.title, `%${query}%`)} OR
    ${ilike(books.author, `%${query}%`)} OR
    ${ilike(books.genre, `%${query}%`)}
  ) AND ${books.availableCopies} > 0`;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(whereCondition);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get results ordered by availability (most copies first)
  const bookResults = (await db
    .select()
    .from(books)
    .where(whereCondition)
    .orderBy(desc(books.availableCopies), asc(books.title))
    .limit(limit)
    .offset(offset)) as Book[];

  const totalPages = Math.ceil(totalCount / limit);

  return {
    books: bookResults,
    totalCount,
    totalPages,
  };
}

/**
 * Search books by rating
 */
export async function searchByRating(
  query: string,
  page: number,
  limit: number
): Promise<SearchResult> {
  const offset = (page - 1) * limit;

  // Search across all fields
  const whereCondition = or(
    ilike(books.title, `%${query}%`),
    ilike(books.author, `%${query}%`),
    ilike(books.genre, `%${query}%`)
  );

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(whereCondition);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get results ordered by rating (highest to lowest)
  const bookResults = (await db
    .select()
    .from(books)
    .where(whereCondition)
    .orderBy(desc(books.rating), asc(books.title))
    .limit(limit)
    .offset(offset)) as Book[];

  const totalPages = Math.ceil(totalCount / limit);

  return {
    books: bookResults,
    totalCount,
    totalPages,
  };
}
