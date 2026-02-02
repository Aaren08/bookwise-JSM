import Image from "next/image";
import React from "react";
import { X, Download } from "lucide-react";
import { downloadReceiptAsPDF } from "../lib/essentials/downloadReceipt";
import { toast } from "sonner";

export type Receipt = {
  receiptId: string;
  issuedAt: string;
  title: string;
  author: string;
  genre: string;
  borrowedOn: string;
  dueDate: string;
  duration: string;
  userName?: string;
  userEmail?: string;
};

type ReceiptModalProps = {
  isOpen: boolean;
  onClose: () => void;
  receipt: Receipt | null;
  borrowStatus?: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
};

const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  receipt,
  borrowStatus,
}) => {
  if (!isOpen || !receipt) return null;

  const handleDownloadPDF = async () => {
    if (!receipt) return;

    const success = await downloadReceiptAsPDF(receipt);

    if (!success) {
      toast.error("Failed to generate PDF. Please try again.");
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container receipt-container">
        <div className="receipt-inner">
          <button className="modal-close-btn" onClick={onClose}>
            <X className="w-4 h-4 text-black" />
          </button>

          <div className="modal-content w-full !items-start">
            {/* Header */}
            <div className="receipt-header">
              <div className="receipt-logo">
                <Image
                  src="/icons/logo.svg"
                  alt="BookWise"
                  width={32}
                  height={32}
                />
                BookWise
              </div>

              {!(borrowStatus === "PENDING") && (
                <button
                  className="download-receipt-btn"
                  onClick={handleDownloadPDF}
                  title="Download as PDF"
                >
                  <Download className="w-5 h-5" />
                </button>
              )}

              <h2 className="modal-title">Borrow Receipt</h2>

              <div className="receipt-meta">
                <div className="card-info-row">
                  <span className="card-info-label">Receipt ID:</span>
                  <span className="card-info-value">#{receipt.receiptId}</span>
                </div>
                <div className="card-info-row">
                  <span className="card-info-label">Date Issued:</span>
                  <span className="card-info-value">
                    {borrowStatus === "PENDING"
                      ? "--/--/----, --:-- --"
                      : receipt.issuedAt}
                  </span>
                </div>
              </div>
            </div>

            {/* Book Details */}
            <div className="receipt-section">
              <h3 className="receipt-section-title">Book Details:</h3>

              <div className="card-info-section">
                <div className="card-info-row">
                  <span className="card-info-label">Title:</span>
                  <span className="card-info-value">{receipt.title}</span>
                </div>
                <div className="card-info-row">
                  <span className="card-info-label">Author:</span>
                  <span className="card-info-value">{receipt.author}</span>
                </div>
                <div className="card-info-row">
                  <span className="card-info-label">Genre:</span>
                  <span className="card-info-value">{receipt.genre}</span>
                </div>
                <div className="card-info-row">
                  <span className="card-info-label">Borrowed On:</span>
                  <span className="card-info-value">
                    {borrowStatus === "PENDING"
                      ? "--/--/----"
                      : receipt.borrowedOn}
                  </span>
                </div>
                <div className="card-info-row">
                  <span className="card-info-label">Due Date:</span>
                  <span className="card-info-value">
                    {borrowStatus === "PENDING"
                      ? "--/--/----"
                      : receipt.dueDate}
                  </span>
                </div>
                <div className="card-info-row">
                  <span className="card-info-label">Duration:</span>
                  <span className="card-info-value">{receipt.duration}</span>
                </div>
              </div>
            </div>

            {/* Terms */}
            <div className="receipt-terms">
              <h4 className="receipt-section-title">Terms</h4>
              <ul>
                <li>Please return the book by the due date.</li>
                <li>Lost or damaged books may incur replacement costs.</li>
              </ul>
            </div>

            {/* Footer */}
            <div className="receipt-footer">
              <p>
                Thank you for using <strong>BookWise</strong>!
              </p>
              <p>
                Website: <strong>bookwise.example.com</strong>
              </p>
              <p>
                Email: <strong>support@bookwise.example.com</strong>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptModal;
