"use client";

import Image from "next/image";
import { Button } from "../ui/button";
import { borrowBook } from "@/lib/actions/book";
import { useState } from "react";
import { showErrorToast, showSuccessToast } from "@/lib/essentials/toast-utils";

interface Props {
  bookId: string;
  userId: string;
  borrowingEligibility: {
    isEligible: boolean;
    message: string;
  };
}

const BorrowBook = ({
  bookId,
  userId,
  borrowingEligibility: { isEligible, message },
}: Props) => {
  const [isBorrowing, setIsBorrowing] = useState(false);

  const handleBorrowBook = async () => {
    if (!isEligible) {
      showErrorToast(message);
      return;
    }
    setIsBorrowing(true);

    try {
      const result = await borrowBook({ userId, bookId });
      if (result.success) {
        showSuccessToast("Book request is forwarded");
      } else {
        showErrorToast(result.error || "Failed to initiate book request");
      }
    } catch (error) {
      console.log(error);
      showErrorToast("Failed to initiate book request");
    } finally {
      setIsBorrowing(false);
    }
  };

  return (
    <Button
      onClick={handleBorrowBook}
      disabled={isBorrowing}
      className="book-overview_btn cursor-pointer"
    >
      <Image src="/icons/book.svg" alt="plus" width={20} height={20} />
      <p
        className="text-xl text-dark-100"
        style={{ fontFamily: "var(--bebas-neue)" }}
      >
        {isBorrowing ? "Initiating Book Request..." : "Borrow Book Request"}
      </p>
    </Button>
  );
};

export default BorrowBook;
