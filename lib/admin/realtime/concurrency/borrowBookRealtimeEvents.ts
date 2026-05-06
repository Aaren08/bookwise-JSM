export const BORROW_BOOK_REALTIME_CHANNEL = "book:borrow:realtime";
export const BORROW_BOOK_REALTIME_REPLAY_KEY =
  "book:borrow:realtime:recent";
export const BORROW_BOOK_REALTIME_SEQUENCE_KEY =
  "book:borrow:realtime:sequence";
export const BORROW_BOOK_REALTIME_REPLAY_LIMIT = 250;

export type BookUpdatedMessage = {
  type: "BOOK_UPDATED";
  timestamp: string;
  bookId: string;
  availableCount: number;
  reservedCount: number;
  borrowedCount: number;
  version: number;
};

export type RequestUpdatedMessage = {
  type: "REQUEST_UPDATED";
  timestamp: string;
  requestId: string;
  bookId: string;
  userId: string;
  status: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED";
};

export type BorrowBookRealtimeMessage =
  | BookUpdatedMessage
  | RequestUpdatedMessage;

export type BorrowBookRealtimeEvent = {
  id: number;
  event: BorrowBookRealtimeMessage["type"];
  message: BorrowBookRealtimeMessage;
  publishedAt: string;
};

export const createBookUpdatedMessage = (
  bookId: string,
  availableCount: number,
  reservedCount: number,
  borrowedCount: number,
  version: number,
): BookUpdatedMessage => ({
  type: "BOOK_UPDATED",
  timestamp: new Date().toISOString(),
  bookId,
  availableCount,
  reservedCount,
  borrowedCount,
  version,
});

export const createRequestUpdatedMessage = (
  requestId: string,
  bookId: string,
  userId: string,
  status: RequestUpdatedMessage["status"],
): RequestUpdatedMessage => ({
  type: "REQUEST_UPDATED",
  timestamp: new Date().toISOString(),
  requestId,
  bookId,
  userId,
  status,
});

export const isBookUpdatedMessage = (
  value: unknown,
): value is BookUpdatedMessage => {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;

  return (
    message.type === "BOOK_UPDATED" &&
    typeof message.timestamp === "string" &&
    typeof message.bookId === "string" &&
    typeof message.availableCount === "number" &&
    typeof message.reservedCount === "number" &&
    typeof message.borrowedCount === "number" &&
    typeof message.version === "number"
  );
};

export const isRequestUpdatedMessage = (
  value: unknown,
): value is RequestUpdatedMessage => {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;

  return (
    message.type === "REQUEST_UPDATED" &&
    typeof message.timestamp === "string" &&
    typeof message.requestId === "string" &&
    typeof message.bookId === "string" &&
    typeof message.userId === "string"
  );
};

export const isBorrowBookRealtimeMessage = (
  value: unknown,
): value is BorrowBookRealtimeMessage =>
  isBookUpdatedMessage(value) || isRequestUpdatedMessage(value);

export const isBorrowBookRealtimeEvent = (
  value: unknown,
): value is BorrowBookRealtimeEvent => {
  if (!value || typeof value !== "object") return false;

  const event = value as Record<string, unknown>;

  return (
    typeof event.id === "number" &&
    typeof event.event === "string" &&
    typeof event.publishedAt === "string" &&
    isBorrowBookRealtimeMessage(event.message)
  );
};

export const encodeBorrowBookSseEvent = (event: BorrowBookRealtimeEvent) =>
  `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.message)}\n\n`;
