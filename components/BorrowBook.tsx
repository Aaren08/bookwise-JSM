"use client";

import Image from "next/image";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { borrowBook } from "@/lib/actions/book";
import { toast } from "sonner";
import { useState } from "react";

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
  const router = useRouter();
  const [isBorrowing, setIsBorrowing] = useState(false);

  const handleBorrowBook = async () => {
    if (!isEligible) {
      toast.error(message, {
        position: "top-right",
        style: {
          background: "#fee2e2",
          color: "#000000",
          border: "1px solid #fca5a5",
        },
        className: "!bg-red-200 !text-black",
      });
      return;
    }
    setIsBorrowing(true);

    try {
      const result = await borrowBook({ userId, bookId });
      if (result.success) {
        toast.success("Book request is forwarded", {
          position: "top-right",
          style: {
            background: "#dcfce7",
            color: "#000000",
            border: "1px solid #86efac",
          },
          className: "!bg-green-200 !text-black",
        });
        router.push("/");
      } else {
        toast.error(result.error, {
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
      toast.error("Failed to initiate book request", {
        position: "top-right",
        style: {
          background: "#fee2e2",
          color: "#000000",
          border: "1px solid #fca5a5",
        },
        className: "!bg-red-200 !text-black",
      });
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
