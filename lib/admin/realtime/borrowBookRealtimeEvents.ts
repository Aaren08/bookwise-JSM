export type BorrowBookRealtimeMessage = {
  type: "BOOK_AVAILABILITY_UPDATED";
  timestamp: string;
  bookId: string;
  availableCount: number;
};

export const createBookAvailabilityUpdatedMessage = (
  bookId: string,
  availableCount: number,
): BorrowBookRealtimeMessage => ({
  type: "BOOK_AVAILABILITY_UPDATED",
  timestamp: new Date().toISOString(),
  bookId,
  availableCount,
});

export const isBorrowBookRealtimeMessage = (
  value: unknown,
): value is BorrowBookRealtimeMessage => {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;

  return (
    message.type === "BOOK_AVAILABILITY_UPDATED" &&
    typeof message.timestamp === "string" &&
    typeof message.bookId === "string" &&
    typeof message.availableCount === "number"
  );
};

export const encodeBorrowBookSseEvent = (
  message: BorrowBookRealtimeMessage,
) => `data: ${JSON.stringify(message)}\n\n`;
