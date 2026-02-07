import Image from "next/image";
import dayjs from "dayjs";
import BookCover from "@/components/book/BookCover";

interface RecentBookCardProps {
  recentBooks: {
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    borrowDate: string;
  };
}

const RecentBookCard = ({ recentBooks }: RecentBookCardProps) => {
  return (
    <div className="recent-book-card">
      {/* Book Info */}
      <div className="dashboard-book-info">
        <BookCover
          variant="small"
          coverColor={recentBooks.coverColor}
          coverImage={recentBooks.bookCover || undefined}
        />

        <div className="dashboard-book-details">
          <h4 className="dashboard-book-title">{recentBooks.bookTitle}</h4>

          {/* Author and Genre */}
          <p className="dashboard-book-metadata">
            By {recentBooks.bookAuthor} <span className="mx-1">•</span>{" "}
            {recentBooks.bookGenre}
          </p>

          {/* Date */}
          <div className="dashboard-book-date">
            <Image
              src="/icons/admin/calendar.svg"
              alt="calendar"
              width={14}
              height={14}
            />
            <p className="text-xs text-dark-200">
              {dayjs(recentBooks.borrowDate).format("MM/DD/YY")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecentBookCard;
