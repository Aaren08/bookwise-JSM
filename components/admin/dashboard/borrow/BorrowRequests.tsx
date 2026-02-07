import Image from "next/image";
import Link from "next/link";
import BorrowRequestList from "./BorrowRequestList";

interface BorrowRequestsProps {
  borrowRecords?: Array<{
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

const BorrowRequests = ({ borrowRecords = [] }: BorrowRequestsProps) => {
  // Count pending requests
  const pendingCount = borrowRecords.filter(
    (record) => record.status === "PENDING",
  ).length;

  return (
    <div className="borrow-requests-container">
      {/* Header with View all button */}
      <div className="borrow-requests-header">
        <h2 className="borrow-requests-title">Borrow Requests</h2>
        <Link href="/admin/borrow-records" className="view-btn">
          View all
        </Link>
      </div>

      {/* Conditional Rendering: Empty State or Request List */}
      {pendingCount === 0 ? (
        <div className="borrow-requests-empty-state">
          <Image
            src="/icons/admin/no-borrow-req.svg"
            alt="No Borrow Requests"
            width={150}
            height={150}
            className="mb-4"
          />
          <h3 className="borrow-requests-empty-title">
            No Pending Book Requests
          </h3>
          <p className="borrow-requests-empty-description">
            There are no borrow book requests awaiting your review at this time.
          </p>
        </div>
      ) : (
        <div className="box-body-scroll-wrapper">
          <div className="box-body-scroll-container">
            <BorrowRequestList records={borrowRecords} />
          </div>
        </div>
      )}
    </div>
  );
};

export default BorrowRequests;
