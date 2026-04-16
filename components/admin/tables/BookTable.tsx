"use client";

import { useMemo, memo, useCallback, useEffect } from "react";
import dayjs from "dayjs";
import Image from "next/image";
import Link from "next/link";
import DeleteBook from "../DeleteBook";
import TableRow from "../shared/TableRow";
import { useSortedData } from "@/lib/admin/essentials/useSortedData";
import { useSearch } from "@/components/admin/context/SearchContext";
import EmptySearch from "../shared/EmptySearch";
import { includes } from "@/lib/utils";

interface Props {
  books: Book[];
}

// Memoized row component to prevent re-renders
const BookRowComponent = memo(
  ({ book, onDelete }: { book: Book; onDelete: (id: string) => void }) => (
    <TableRow>
      <td className="py-4 pr-4 max-sm:pr-6">
        <div className="flex items-center gap-3">
          {book.coverUrl ? (
            <Image
              src={book.coverUrl}
              alt={book.title}
              width={40}
              height={60}
              style={{ width: "auto", height: "auto" }}
              className="rounded-sm object-cover"
            />
          ) : (
            <div className="h-[60px] w-[40px] bg-gray-200 rounded-sm" />
          )}
          <p className="font-semibold text-dark-400 line-clamp-1 max-w-[200px]">
            {book.title}
          </p>
        </div>
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {book.author}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {book.genre}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {dayjs(book.createdAt).format("MMM DD YYYY")}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <div className="flex items-center gap-2.5">
          <Link href={`/admin/books/${book.id}/edit`}>
            <Image
              src="/icons/admin/edit.svg"
              alt="edit"
              width={24}
              height={24}
              style={{ width: "auto", height: "auto" }}
            />
          </Link>
          <DeleteBook id={book.id} onDelete={() => onDelete(book.id)} />
        </div>
      </td>
    </TableRow>
  ),
);

BookRowComponent.displayName = "BookRow";

/**
 * BookTable now renders as tbody
 * This allows PartialTableWrapper to control thead separately
 * Header remains visible while tbody is suspended and reloaded
 */
const BookTable = ({ books }: Props) => {
  const { query, sortOrder } = useSearch();

  const sortFn = useCallback((a: Book, b: Book, order: "asc" | "desc") => {
    if (order === "asc") {
      return a.title.localeCompare(b.title);
    } else {
      return b.title.localeCompare(a.title);
    }
  }, []);

  const { sortedData, setSortedData, handleSort } = useSortedData<Book>(
    books,
    sortFn,
  );

  useEffect(() => {
    handleSort(sortOrder);
  }, [sortOrder, handleSort]);

  /* filtered view */
  const filteredBooks = useMemo(() => {
    if (!query.trim()) return sortedData;
    return sortedData.filter(
      (b) =>
        includes(b.title, query) ||
        includes(b.author, query) ||
        includes(b.genre, query),
    );
  }, [sortedData, query]);

  const handleDelete = useCallback((id: string) => {
    setSortedData((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <tbody>
      {filteredBooks.length === 0 && query.trim() ? (
        <EmptySearch query={query} entity="books" colSpan={5} />
      ) : (
        filteredBooks.map((book) => (
          <BookRowComponent key={book.id} book={book} onDelete={handleDelete} />
        ))
      )}
    </tbody>
  );
};

export default BookTable;
