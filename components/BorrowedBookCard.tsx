"use client";

import Image from "next/image";
import BookCard from "./BookCard";
import {
  calculateBorrowStatus,
  getBorrowStatusColor,
  getBorrowStatusText,
} from "@/lib/returnPolicy";

const OVERDUE_ICON_FILTER =
  "brightness(0) saturate(100%) invert(43%) sepia(94%) saturate(3217%) hue-rotate(334deg) brightness(101%) contrast(93%)";

interface BorrowedBookCardProps extends Book {
  borrowDate: Date | string;
  dueDate: Date | string;
}

const BorrowedBookCard = ({
  borrowDate,
  dueDate,
  ...book
}: BorrowedBookCardProps) => {
  const status = calculateBorrowStatus(borrowDate, dueDate);
  const statusColor = getBorrowStatusColor(status.isOverdue);
  const statusText = getBorrowStatusText(status);

  return (
    <BookCard
      {...book}
      className="xs:w-52 w-full relative bg-dark-800 rounded-2xl p-4"
    >
      {/* Overdue Warning Icon - Top Left */}
      {status.isOverdue && (
        <div className="absolute top-0 left-0 z-10">
          <Image
            src="/icons/warning.svg"
            alt="warning"
            width={18}
            height={18}
          />
        </div>
      )}

      <div className="mt-3 w-full">
        {/* Borrowed Date */}
        <div className="book-loaned">
          <Image
            src="/icons/book-2.svg"
            alt="borrowed"
            width={18}
            height={18}
            className="object-contain"
          />
          <p className="text-light-100 text-sm">
            Borrowed on {status.borrowDate}
          </p>
        </div>

        {/* Due Status with Receipt Icon */}
        <div className="book-loaned mt-2 justify-between">
          <div className="flex items-center gap-1">
            <Image
              src={
                status.isOverdue ? "/icons/warning.svg" : "/icons/calendar.svg"
              }
              alt="status"
              width={18}
              height={18}
              className="object-contain"
              style={
                status.isOverdue ? { filter: OVERDUE_ICON_FILTER } : undefined
              }
            />
            <p className="text-sm font-medium" style={{ color: statusColor }}>
              {statusText}
            </p>
          </div>

          {/* Receipt Icon - Right Side */}
          <Image
            src="/icons/receipt.svg"
            alt="receipt"
            width={16}
            height={16}
            className="object-contain"
            style={
              status.isOverdue ? { filter: OVERDUE_ICON_FILTER } : undefined
            }
          />
        </div>
      </div>
    </BookCard>
  );
};

export default BorrowedBookCard;
