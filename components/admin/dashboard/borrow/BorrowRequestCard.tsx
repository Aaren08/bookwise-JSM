import Image from "next/image";
import Link from "next/link";
import { Eye } from "lucide-react";
import dayjs from "dayjs";
import BookCover from "@/components/book/BookCover";

interface BorrowRequestCardProps {
  record: {
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    userFullName: string;
    userAvatar: string | null;
    borrowDate: string;
    status: string;
  };
}

const BorrowRequestCard = ({ record }: BorrowRequestCardProps) => {
  return (
    <div className="borrow-request-card">
      {/* Book Info */}
      <div className="dashboard-book-info">
        <BookCover
          variant="small"
          coverColor={record.coverColor}
          coverImage={record.bookCover || undefined}
        />

        <div className="dashboard-book-details">
          <h4 className="dashboard-book-title">{record.bookTitle}</h4>

          {/* Author and Genre */}
          <p className="dashboard-book-metadata">
            By {record.bookAuthor} <span className="mx-1">•</span>{" "}
            {record.bookGenre}
          </p>

          {/* User Info */}
          <div className="borrow-request-user">
            {record.userAvatar ? (
              <Image
                src={record.userAvatar}
                alt={record.userFullName}
                width={20}
                height={20}
                className="rounded-full object-cover"
              />
            ) : (
              <div className="borrow-request-user-placeholder">
                <span className="borrow-request-user-initial">
                  {record.userFullName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <p className="borrow-request-user-name">{record.userFullName}</p>

            {/* Date */}
            <div className="dashboard-book-date">
              <Image
                src="/icons/admin/calendar.svg"
                alt="calendar"
                width={14}
                height={14}
              />
              <p className="text-xs text-dark-200">
                {dayjs(record.borrowDate).format("MM/DD/YY")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* View Action */}
      <Link
        href="/admin/borrow-records"
        className="borrow-request-view-btn"
        aria-label="View borrow request details"
      >
        <Eye className="size-4 text-primary-admin group-hover:text-primary-admin/80" />
      </Link>
    </div>
  );
};

export default BorrowRequestCard;
