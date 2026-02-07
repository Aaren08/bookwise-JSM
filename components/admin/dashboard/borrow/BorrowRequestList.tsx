"use client";

import BorrowRequestCard from "./BorrowRequestCard";

interface BorrowRequestListProps {
  records: Array<{
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
  }>;
}

const BorrowRequestList = ({ records }: BorrowRequestListProps) => {
  // Filter only pending requests and take top 3 most recent
  const pendingRequests = records
    .filter((record) => record.status === "PENDING")
    .slice(0, 5);

  return (
    <div className="space-y-3">
      {pendingRequests.map((record) => (
        <BorrowRequestCard key={record.id} record={record} />
      ))}
    </div>
  );
};

export default BorrowRequestList;
