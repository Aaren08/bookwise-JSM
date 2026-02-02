"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { getReceipt } from "@/lib/admin/actions/receipt";
import ReceiptModal, { Receipt } from "./ReceiptModal";
import { showErrorToast } from "@/lib/essentials/toast-utils";

const OVERDUE_ICON_FILTER =
  "brightness(0) saturate(100%) invert(43%) sepia(94%) saturate(3217%) hue-rotate(334deg) brightness(101%) contrast(93%)";

const RETURNED_ICON_FILTER =
  "brightness(0) saturate(100%) invert(64%) sepia(98%) saturate(2565%) hue-rotate(89deg) brightness(97%) contrast(78%)";

interface ReceiptButtonProps {
  borrowRecordId?: string;
  borrowStatus: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
  showOverdueWarning: boolean;
  userRole?: "USER" | "ADMIN";
}

const ReceiptButton = ({
  borrowRecordId,
  borrowStatus,
  showOverdueWarning,
}: ReceiptButtonProps) => {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReceiptLoading, setIsReceiptLoading] = useState(false);

  const handleReceiptClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!borrowRecordId) return;

    setIsReceiptLoading(true);
    try {
      const res = await getReceipt(borrowRecordId);
      if (res.success && res.data) {
        setReceipt(res.data as Receipt);
        setIsModalOpen(true);
      } else {
        showErrorToast(res.error || "Failed to fetch receipt");
      }
    } catch (error) {
      console.log(error);
      showErrorToast("An error occurred while fetching receipt");
    } finally {
      setIsReceiptLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          "receipt-btn",
          isReceiptLoading && "opacity-50 pointer-events-none animate-pulse",
        )}
        onClick={handleReceiptClick}
      >
        <Image
          src="/icons/receipt.svg"
          alt="receipt"
          width={18}
          height={18}
          className="object-contain"
          style={
            borrowStatus === "RETURNED"
              ? { filter: RETURNED_ICON_FILTER }
              : showOverdueWarning || borrowStatus === "LATE_RETURN"
                ? { filter: OVERDUE_ICON_FILTER }
                : undefined
          }
        />
      </button>

      <ReceiptModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        receipt={receipt}
        borrowStatus={borrowStatus}
      />
    </>
  );
};

export default ReceiptButton;
