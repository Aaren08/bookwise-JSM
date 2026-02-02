"use client";

import dayjs from "dayjs";
import Image from "next/image";
import Link from "next/link";
import DeleteBook from "../DeleteBook";
import TableContainer from "../shared/TableContainer";
import TableRow from "../shared/TableRow";
import { useSortedData } from "@/lib/essentials/useSortedData";

interface Props {
  books: Book[];
}

const BookTable = ({ books }: Props) => {
  const { sortedData, setSortedData, handleSort } = useSortedData<Book>(
    books,
    (a, b, order) => {
      if (order === "asc") {
        return a.title.localeCompare(b.title);
      } else {
        return b.title.localeCompare(a.title);
      }
    },
  );

  return (
    <>
      <TableContainer
        title="All Books"
        onSort={handleSort}
        showCreateButton={true}
      >
        <thead className="h-14 bg-blue-50">
          <tr>
            <th className="header-cell">Book Title</th>
            <th className="header-cell">Author</th>
            <th className="header-cell">Genre</th>
            <th className="header-cell">Date Created</th>
            <th className="header-cell">Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedData.map((book) => (
            <TableRow key={book.id}>
              <td className="py-4 pr-4 max-sm:pr-6">
                <div className="flex items-center gap-3">
                  {book.coverUrl ? (
                    <Image
                      src={book.coverUrl}
                      alt={book.title}
                      width={40}
                      height={60}
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
                    />
                  </Link>
                  <DeleteBook
                    id={book.id}
                    onDelete={() =>
                      setSortedData((prev) =>
                        prev.filter((b) => b.id !== book.id),
                      )
                    }
                  />
                </div>
              </td>
            </TableRow>
          ))}
        </tbody>
      </TableContainer>
    </>
  );
};

export default BookTable;
