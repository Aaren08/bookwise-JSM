"use client";

import { useMemo, memo, useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";
import Image from "next/image";
import Link from "next/link";
import router from "next/router";
import DeleteBook from "../DeleteBook";
import TableRow from "../shared/TableRow";
import { useSortedData } from "@/lib/admin/essentials/useSortedData";
import { useSearch } from "@/components/admin/context/SearchContext";
import EmptySearch from "../shared/EmptySearch";
import { includes } from "@/lib/utils";
import { showErrorToast } from "@/lib/essentials/toast-utils";
import RowLockIndicator from "../shared/RowLockIndicator";
import { useRowLock } from "@/lib/admin/realtime/concurrency/useRowLock";
import { useRealtimeUpdates } from "@/lib/admin/realtime/concurrency/useRealtimeUpdates";
import type { AdminRowLock } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

interface Props {
  books: Book[];
  currentAdmin: AdminActor;
}

const BookRowComponent = memo(
  ({
    book,
    isLocked,
    lock,
    onDelete,
    onAcquireLock,
    onReleaseLock,
  }: {
    book: Book;
    isLocked: boolean;
    lock: AdminRowLock | null;
    onDelete: (id: string) => void;
    onAcquireLock: (book: Book) => Promise<boolean>;
    onReleaseLock: (book: Book) => Promise<void>;
  }) => (
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
            <div className="h-[60px] w-[40px] rounded-sm bg-gray-200" />
          )}
          <p className="line-clamp-1 max-w-[200px] font-semibold text-dark-400">
            {book.title}
          </p>
        </div>
      </td>
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {book.author}
      </td>
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {book.genre}
      </td>
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {dayjs(book.createdAt).format("MMM DD YYYY")}
      </td>
      <td className="relative py-4 pr-4 max-sm:pr-6">
        <RowLockIndicator lock={lock} />
        <div className="flex items-center gap-2.5">
          <Link
            href={`/admin/books/${book.id}/edit`}
            onClick={async (event) => {
              event.preventDefault();
              const acquired = await onAcquireLock(book);
              if (acquired) {
                router.push(`/admin/books/${book.id}/edit`);
              }
            }}
            className={isLocked ? "pointer-events-none opacity-50" : undefined}
          >
            <Image
              src="/icons/admin/edit.svg"
              alt="edit"
              width={24}
              height={24}
              style={{ width: "auto", height: "auto" }}
            />
          </Link>
          <DeleteBook
            id={book.id}
            expectedVersion={book.version}
            onDelete={() => onDelete(book.id)}
            onAcquireLock={() => onAcquireLock(book)}
            onReleaseLock={() => onReleaseLock(book)}
            lockToken={lock?.token}
            disabled={isLocked}
          />
        </div>
      </td>
    </TableRow>
  ),
);

BookRowComponent.displayName = "BookRow";

const BookTable = ({ books, currentAdmin }: Props) => {
  const { query, sortOrder } = useSearch();
  const [pinnedRowId, setPinnedRowId] = useState<string | null>(null);

  const sortFn = useCallback((a: Book, b: Book, order: "asc" | "desc") => {
    if (order === "asc") {
      return a.title.localeCompare(b.title);
    }

    return b.title.localeCompare(a.title);
  }, []);

  const { sortedData, setSortedData, handleSort } = useSortedData<Book>(
    books,
    sortFn,
  );

  const matchesFilter = useCallback(
    (book: Book) =>
      !query.trim() ||
      includes(book.title, query) ||
      includes(book.author, query) ||
      includes(book.genre, query),
    [query],
  );

  useEffect(() => {
    handleSort(sortOrder);
  }, [sortOrder, handleSort]);

  useRealtimeUpdates({
    entity: "books",
    items: sortedData,
    setItems: setSortedData,
    sortFn,
    sortOrder,
    pinnedRowId,
    matchesFilter,
  });

  const filteredBooks = useMemo(
    () => sortedData.filter(matchesFilter),
    [matchesFilter, sortedData],
  );

  const rowIds = useMemo(() => filteredBooks.map((book) => book.id), [filteredBooks]);

  const rowLock = useRowLock({
    entity: "books",
    rowIds,
    currentAdminId: currentAdmin.id,
  });

  const handleDelete = useCallback(
    (id: string) => {
      setSortedData((prev) => prev.filter((book) => book.id !== id));
      setPinnedRowId((current) => (current === id ? null : current));
    },
    [setSortedData],
  );

  const onAcquireLock = useCallback(
    async (book: Book) => {
      if (rowLock.isLockedByOther(book.id)) {
        const lock = rowLock.lockForRow(book.id);
        showErrorToast(
          lock ? `Row locked by ${lock.adminName}` : "Row is locked",
        );
        return false;
      }

      if (rowLock.isLockedByCurrentAdmin(book.id)) {
        setPinnedRowId(book.id);
        return true;
      }

      const result = await rowLock.acquireRowLock(book.id);
      if (!result.success) {
        showErrorToast(result.message || "Unable to lock row");
        return false;
      }

      setPinnedRowId(book.id);
      return true;
    },
    [rowLock],
  );

  const onReleaseLock = useCallback(
    async (book: Book) => {
      await rowLock.releaseRowLock(book.id);
      setPinnedRowId((current) => (current === book.id ? null : current));
    },
    [rowLock],
  );

  return (
    <tbody>
      {filteredBooks.length === 0 && query.trim() ? (
        <EmptySearch query={query} entity="books" colSpan={5} />
      ) : (
        filteredBooks.map((book) => (
          <BookRowComponent
            key={book.id}
            book={book}
            isLocked={rowLock.isLockedByOther(book.id)}
            lock={rowLock.lockForRow(book.id)}
            onDelete={handleDelete}
            onAcquireLock={onAcquireLock}
            onReleaseLock={onReleaseLock}
          />
        ))
      )}
    </tbody>
  );
};

export default BookTable;
