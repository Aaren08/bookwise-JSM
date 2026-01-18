"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useState } from "react";
import BookCard from "./BookCard";
import {
  calculateBorrowStatus,
  getBorrowStatusColor,
  getBorrowStatusText,
} from "@/lib/returnPolicy";
import { dismissBorrowRecord } from "@/lib/actions/book";
import { formatReturnDate } from "@/lib/utils";
import { toast } from "sonner";

const OVERDUE_ICON_FILTER =
  "brightness(0) saturate(100%) invert(43%) sepia(94%) saturate(3217%) hue-rotate(334deg) brightness(101%) contrast(93%)";

const RETURNED_ICON_FILTER =
  "brightness(0) saturate(100%) invert(64%) sepia(98%) saturate(2565%) hue-rotate(89deg) brightness(97%) contrast(78%)";

interface BorrowedBookCardProps extends Book {
  borrowDate: Date | string;
  dueDate: Date | string;
  borrowRecordId?: string;
  borrowStatus?: "BORROWED" | "RETURNED" | "LATE_RETURN";
  returnDate?: Date | string | null;
}

const BorrowedBookCard = ({
  borrowDate,
  dueDate,
  borrowRecordId,
  borrowStatus = "BORROWED",
  returnDate,
  ...book
}: BorrowedBookCardProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const status = calculateBorrowStatus(borrowDate, dueDate);
  const statusColor = getBorrowStatusColor(status.isOverdue);
  const statusText = getBorrowStatusText(status);

  const handleDismiss = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!borrowRecordId) return;

    setIsLoading(true);
    try {
      const result = await dismissBorrowRecord(borrowRecordId);
      if (result.success) {
        setIsDismissed(true);
        toast.success("Record dismissed", {
          position: "top-right",
          style: {
            background: "#dcfce7",
            color: "#000000",
            border: "1px solid #86efac",
          },
          className: "!bg-green-200 !text-black",
        });
      } else {
        toast.error(result.error || "Failed to dismiss record", {
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
      }
    } catch {
      toast.error("Failed to dismiss record", {
        position: "top-right",
        style: {
          background: "#fee2e2",
          color: "#000000",
          border: "1px solid #fca5a5",
        },
        className: "!bg-red-200 !text-black",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isDismissed) {
    return null;
  }

  const isResolved =
    borrowStatus === "RETURNED" || borrowStatus === "LATE_RETURN";
  const showOverdueWarning = borrowStatus === "BORROWED" && status.isOverdue;

  return (
    <BookCard
      {...book}
      className="xs:w-60 w-full relative bg-dark-800 rounded-2xl p-4"
    >
      {/* Overdue Warning Icon - Top Left (only for BORROWED status) */}
      {showOverdueWarning && (
        <div className="absolute -top-2 -left-2 z-10">
          <Image
            src="/icons/warning.svg"
            alt="warning"
            width={24}
            height={24}
          />
        </div>
      )}

      {/* Dismiss Button - Top Right (for resolved statuses) */}
      {isResolved && (
        <button
          onClick={handleDismiss}
          disabled={isLoading}
          className="dismiss-btn"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4 text-white" />
        </button>
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

        {/* Due/Return Status */}
        <div className="book-loaned mt-2 justify-between">
          <div className="flex items-center gap-1">
            {borrowStatus === "RETURNED" && (
              <>
                <Image
                  src="/icons/tick.svg"
                  alt="returned"
                  width={18}
                  height={18}
                  className="object-contain"
                />
                <p className="text-sm font-medium text-green-500">
                  Returned on {returnDate && formatReturnDate(returnDate)}
                </p>
              </>
            )}

            {borrowStatus === "LATE_RETURN" && (
              <>
                <Image
                  src="/icons/warning.svg"
                  alt="late return"
                  width={18}
                  height={18}
                  className="object-contain"
                />
                <p className="text-sm font-medium text-red-500">
                  Returned on {returnDate && formatReturnDate(returnDate)}
                </p>
              </>
            )}

            {borrowStatus === "BORROWED" && (
              <>
                <Image
                  src={
                    status.isOverdue
                      ? "/icons/warning.svg"
                      : "/icons/calendar.svg"
                  }
                  alt="status"
                  width={18}
                  height={18}
                  className="object-contain"
                  style={
                    status.isOverdue
                      ? { filter: OVERDUE_ICON_FILTER }
                      : undefined
                  }
                />
                <p
                  className="text-sm font-medium"
                  style={{ color: statusColor }}
                >
                  {statusText}
                </p>
              </>
            )}
          </div>

          {/* Receipt Icon - Right Side */}
          <Image
            src="/icons/receipt.svg"
            alt="receipt"
            width={16}
            height={16}
            className="object-contain"
            style={
              borrowStatus === "RETURNED"
                ? { filter: RETURNED_ICON_FILTER }
                : showOverdueWarning || borrowStatus === "LATE_RETURN"
                  ? { filter: OVERDUE_ICON_FILTER }
                  : undefined
            }
          />
        </div>
      </div>
    </BookCard>
  );
};

export default BorrowedBookCard;
