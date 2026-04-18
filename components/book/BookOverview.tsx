"use client";

import Image from "next/image";
import BookCover from "./BookCover";
import BorrowBook from "./BorrowBook";
import type { BorrowingEligibility } from "@/lib/performance/cache";
import { useEffect, useState } from "react";

type BookOverviewProps = Book & {
  userId: string;
  borrowingEligibility: BorrowingEligibility | null;
};

const BookOverview = ({
  title,
  author,
  genre,
  rating,
  totalCopies,
  availableCopies: initialAvailableCopies,
  description,
  coverColor,
  coverUrl,
  id,
  userId,
  borrowingEligibility,
}: BookOverviewProps) => {
  const [availableCopies, setAvailableCopies] = useState(initialAvailableCopies);

  useEffect(() => {
    let isActive = true;
    let stream: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!isActive) return;

      stream = new EventSource(`/api/stream?bookId=${id}`, { withCredentials: true });

      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (
            payload.type === "BOOK_AVAILABILITY_UPDATED" && 
            payload.bookId === id
          ) {
            setAvailableCopies(payload.availableCount);
          }
        } catch (error) {
          console.error("Invalid streaming message:", error);
        }
      };

      stream.onerror = () => {
        stream?.close();
        if (!isActive) return;
        
        reconnectTimeout = setTimeout(() => {
          connect();
        }, 2000);
      };
    };

    connect();

    return () => {
      isActive = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      stream?.close();
    };
  }, [id]);

  return (
    <section className="book-overview">
      <div className="flex flex-1 flex-col gap-5">
        <h1>{title}</h1>

        <div className="book-info">
          <p>
            By: <span className="font-semibold text-light-200">{author}</span>
          </p>

          <p>
            Category:{" "}
            <span className="font-semibold text-light-200">{genre}</span>
          </p>

          <div className="flex flex-row gap-1">
            <Image src="/icons/star.svg" alt="star" width={22} height={22} />
            <p>{rating}/5</p>
          </div>
        </div>

        <div className="book-copies">
          <p>
            Total Books:<span>{totalCopies}</span>
          </p>

          <p>
            Available Books:<span>{availableCopies}</span>
          </p>
        </div>

        <p className="book-description">{description}</p>

        {borrowingEligibility && (
          <BorrowBook
            bookId={id}
            userId={userId}
            borrowingEligibility={borrowingEligibility}
          />
        )}
      </div>

      <div className="relative flex flex-1 justify-center">
        <div className="relative">
          <BookCover
            variant="wide"
            className="z-10"
            coverColor={coverColor}
            coverImage={coverUrl}
            priority
          />

          <div className="absolute left-16 top-10 rotate-12 opacity-40 max-sm:hidden">
            <BookCover
              variant="wide"
              coverColor={coverColor}
              coverImage={coverUrl}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default BookOverview;
