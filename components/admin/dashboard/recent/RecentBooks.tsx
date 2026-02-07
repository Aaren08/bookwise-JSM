import Image from "next/image";
import Link from "next/link";
import RecentBookList from "./RecentBookList";

interface RecentBooksProps {
  recentBooks: Array<{
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    createdAt: string;
  }>;
}

const RecentBooks = ({ recentBooks }: RecentBooksProps) => {
  return (
    <div className="recent-books-container">
      {/* Header with View all button */}
      <div className="recent-books-header">
        <h2 className="recent-books-title">Recently Added Books</h2>
        <Link href="/admin/books" className="view-btn">
          View all
        </Link>
      </div>

      {/* Add New Book Button */}
      <Link href="/admin/books/new" className="add-new-book_btn">
        <div>
          <Image
            src="/icons/admin/plus.svg"
            alt="Add New Book"
            width={20}
            height={20}
          />
        </div>
        <p>Add New Book</p>
      </Link>

      {/* Books list */}
      <div className="mt-7">
        <div className="box-body-scroll-wrapper">
          <div className="recent-books-scroll-container">
            <RecentBookList recentBooks={recentBooks} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecentBooks;
