"use client";

import { Button } from "@/components/ui/button";
import dayjs from "dayjs";
import { Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import FilterData from "./FilterData";
import DeleteBook from "./DeleteBook";
import { useEffect, useState } from "react";

interface Props {
  books: Book[];
}

const BookTable = ({ books }: Props) => {
  const [sortedBooks, setSortedBooks] = useState<Book[]>(books);

  useEffect(() => {
    setSortedBooks(books);
  }, [books]);

  const handleSort = (order: "asc" | "desc") => {
    const sorted = [...sortedBooks].sort((a, b) => {
      if (order === "asc") {
        return a.title.localeCompare(b.title);
      } else {
        return b.title.localeCompare(a.title);
      }
    });
    setSortedBooks(sorted);
  };

  return (
    <section className="w-full rounded-2xl bg-white p-7 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-dark-400">All Books</h2>
        <div className="flex items-center gap-2">
          <FilterData onSort={handleSort} />
          <Button
            asChild
            className="bg-primary-admin hover:bg-primary-admin/90 text-white"
          >
            <Link href="/admin/books/new">
              <Plus className="mr-2 h-4 w-4" />
              Create a New Book
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-7 w-full overflow-x-auto">
        <table className="w-full min-w-max table-auto text-left">
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
            {sortedBooks.map((book) => (
              <tr
                key={book.id}
                className="border-b border-light-400 last:border-0 hover:bg-light-300/50 transition-colors"
              >
                <td className="py-4 pr-4">
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
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {book.author}
                </td>
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {book.genre}
                </td>
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {dayjs(book.createdAt).format("MMM DD YYYY")}
                </td>
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-2.5">
                    <Link href={`/admin/books/${book.id}/edit`}>
                      <Image
                        src="/icons/admin/edit.svg"
                        alt="edit"
                        width={24}
                        height={24}
                      />
                    </Link>
                    <DeleteBook id={book.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default BookTable;
