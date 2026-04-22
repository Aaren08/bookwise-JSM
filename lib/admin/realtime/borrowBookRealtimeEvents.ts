// ─── BOOK_UPDATED ──────────────────────────────────────────────────────────
// Broadcast whenever availableCopies, reservedCount, or borrowedCount change.
export type BookUpdatedMessage = {
  type: "BOOK_UPDATED";
  timestamp: string;
  bookId: string;
  availableCount: number;
  reservedCount: number;
  borrowedCount: number;
};

// ─── REQUEST_UPDATED ───────────────────────────────────────────────────────
// Broadcast when a borrow-record status changes (admin approval, rejection…).
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

// ─── Factories ─────────────────────────────────────────────────────────────

export const createBookUpdatedMessage = (
  bookId: string,
  availableCount: number,
  reservedCount: number,
  borrowedCount: number,
): BookUpdatedMessage => ({
  type: "BOOK_UPDATED",
  timestamp: new Date().toISOString(),
  bookId,
  availableCount,
  reservedCount,
  borrowedCount,
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

// ─── Type Guards ───────────────────────────────────────────────────────────

export const isBookUpdatedMessage = (
  value: unknown,
): value is BookUpdatedMessage => {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    m.type === "BOOK_UPDATED" &&
    typeof m.timestamp === "string" &&
    typeof m.bookId === "string" &&
    typeof m.availableCount === "number" &&
    typeof m.reservedCount === "number" &&
    typeof m.borrowedCount === "number"
  );
};

export const isRequestUpdatedMessage = (
  value: unknown,
): value is RequestUpdatedMessage => {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    m.type === "REQUEST_UPDATED" &&
    typeof m.timestamp === "string" &&
    typeof m.requestId === "string" &&
    typeof m.bookId === "string" &&
    typeof m.userId === "string"
  );
};

/** Backward-compat alias kept for any code still referencing the old type name. */
export const isBorrowBookRealtimeMessage = (
  value: unknown,
): value is BorrowBookRealtimeMessage =>
  isBookUpdatedMessage(value) || isRequestUpdatedMessage(value);

// ─── SSE Encoder ──────────────────────────────────────────────────────────

export const encodeBorrowBookSseEvent = (
  message: BorrowBookRealtimeMessage,
) => `data: ${JSON.stringify(message)}\n\n`;

