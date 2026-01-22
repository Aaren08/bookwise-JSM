"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { generateReceipt } from "@/lib/admin/actions/receipt";
import { toast } from "sonner";
import ReceiptModal, { Receipt } from "@/components/ReceiptModal";

interface Props {
  borrowRecordId: string;
  status: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
}

const GenerateReceipt = ({ borrowRecordId, status }: Props) => {
  const [isLoading, setIsLoading] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const res = await generateReceipt(borrowRecordId);
      if (res.success && res.data) {
        setReceipt(res.data as Receipt);
        setIsModalOpen(true);
        setHasGenerated(true);
      } else {
        toast.error(res.error || "Failed to generate receipt", {
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
      }
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while generating receipt", {
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

  return (
    <>
      <Button
        onClick={handleGenerate}
        disabled={isLoading || hasGenerated || status !== "PENDING"}
        variant="outline"
        className="generate-btn"
      >
        <Image
          src="/icons/admin/receipt.svg"
          alt="receipt"
          width={16}
          height={16}
        />
        {isLoading ? "Generating..." : hasGenerated ? "Generated" : "Generate"}
      </Button>

      <ReceiptModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        receipt={receipt}
        role="ADMIN"
      />
    </>
  );
};

export default GenerateReceipt;
