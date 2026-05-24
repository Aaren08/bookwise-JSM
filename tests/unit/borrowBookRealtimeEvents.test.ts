import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBookUpdatedMessage,
  createRequestUpdatedMessage,
  isBookUpdatedMessage,
  isRequestUpdatedMessage,
  isBorrowBookRealtimeMessage,
  isBorrowBookRealtimeEvent,
  encodeBorrowBookSseEvent,
  BORROW_BOOK_REALTIME_CHANNEL,
  BORROW_BOOK_REALTIME_REPLAY_KEY,
  BORROW_BOOK_REALTIME_SEQUENCE_KEY,
  BORROW_BOOK_REALTIME_REPLAY_LIMIT,
  type BorrowBookRealtimeEvent,
  type BookUpdatedMessage,
  type RequestUpdatedMessage,
} from "@/lib/admin/realtime/concurrency/borrowBookRealtimeEvents";

describe("createBookUpdatedMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
  });

  it("creates a BOOK_UPDATED message with correct fields", () => {
    const result = createBookUpdatedMessage("book-1", 5, 2, 3, 7);

    expect(result).toEqual({
      type: "BOOK_UPDATED",
      timestamp: "2026-05-24T12:00:00.000Z",
      bookId: "book-1",
      availableCount: 5,
      reservedCount: 2,
      borrowedCount: 3,
      version: 7,
    });
  });

  it("uses the current timestamp at call time", () => {
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    const result = createBookUpdatedMessage("b1", 1, 0, 0, 1);
    expect(result.timestamp).toBe("2027-01-01T00:00:00.000Z");
  });

  it("accepts zero counts", () => {
    const result = createBookUpdatedMessage("b1", 0, 0, 0, 1);
    expect(result.availableCount).toBe(0);
    expect(result.reservedCount).toBe(0);
    expect(result.borrowedCount).toBe(0);
  });
});

describe("createRequestUpdatedMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
  });

  it("creates a REQUEST_UPDATED message with correct fields", () => {
    const result = createRequestUpdatedMessage("req-1", "book-1", "user-1", "BORROWED");

    expect(result).toEqual({
      type: "REQUEST_UPDATED",
      timestamp: "2026-05-24T12:00:00.000Z",
      requestId: "req-1",
      bookId: "book-1",
      userId: "user-1",
      status: "BORROWED",
    });
  });

  it("accepts all valid statuses", () => {
    const statuses = ["PENDING", "BORROWED", "RETURNED", "LATE_RETURN", "REJECTED"] as const;
    for (const status of statuses) {
      const result = createRequestUpdatedMessage("req-1", "b1", "u1", status);
      expect(result.status).toBe(status);
    }
  });
});

describe("isBookUpdatedMessage", () => {
  const valid: BookUpdatedMessage = {
    type: "BOOK_UPDATED",
    timestamp: "2026-05-24T12:00:00.000Z",
    bookId: "book-1",
    availableCount: 5,
    reservedCount: 2,
    borrowedCount: 3,
    version: 7,
  };

  it("returns true for a valid BOOK_UPDATED message", () => {
    expect(isBookUpdatedMessage(valid)).toBe(true);
  });

  it("returns false for null", () => expect(isBookUpdatedMessage(null)).toBe(false));
  it("returns false for undefined", () => expect(isBookUpdatedMessage(undefined)).toBe(false));
  it("returns false for a string", () => expect(isBookUpdatedMessage("hello")).toBe(false));
  it("returns false for a number", () => expect(isBookUpdatedMessage(42)).toBe(false));
  it("returns false for an array", () => expect(isBookUpdatedMessage([])).toBe(false));

  it("returns false for wrong type", () => {
    expect(isBookUpdatedMessage({ ...valid, type: "REQUEST_UPDATED" })).toBe(false);
  });

  it("returns false when timestamp is missing", () => {
    const { timestamp: _, ...rest } = valid;
    expect(isBookUpdatedMessage(rest)).toBe(false);
  });

  it("returns false when bookId is not a string", () => {
    expect(isBookUpdatedMessage({ ...valid, bookId: 123 })).toBe(false);
  });

  it("returns false when availableCount is not a number", () => {
    expect(isBookUpdatedMessage({ ...valid, availableCount: "5" })).toBe(false);
  });

  it("returns false when version is not a number", () => {
    expect(isBookUpdatedMessage({ ...valid, version: "7" })).toBe(false);
  });
});

describe("isRequestUpdatedMessage", () => {
  const valid: RequestUpdatedMessage = {
    type: "REQUEST_UPDATED",
    timestamp: "2026-05-24T12:00:00.000Z",
    requestId: "req-1",
    bookId: "book-1",
    userId: "user-1",
    status: "BORROWED",
  };

  it("returns true for a valid REQUEST_UPDATED message", () => {
    expect(isRequestUpdatedMessage(valid)).toBe(true);
  });

  it("returns false for null", () => expect(isRequestUpdatedMessage(null)).toBe(false));

  it("returns false for wrong type", () => {
    expect(isRequestUpdatedMessage({ ...valid, type: "BOOK_UPDATED" })).toBe(false);
  });

  it("returns false when requestId is missing", () => {
    const { requestId: _, ...rest } = valid;
    expect(isRequestUpdatedMessage(rest)).toBe(false);
  });

  it("does NOT validate the `status` field type — type guard only checks string fields", () => {
    expect(isRequestUpdatedMessage({ ...valid, status: 123 })).toBe(true);
  });
});

describe("isBorrowBookRealtimeMessage", () => {
  it("returns true for BOOK_UPDATED message", () => {
    expect(
      isBorrowBookRealtimeMessage({
        type: "BOOK_UPDATED",
        timestamp: "2026-01-01T00:00:00.000Z",
        bookId: "b1",
        availableCount: 1,
        reservedCount: 0,
        borrowedCount: 0,
        version: 1,
      }),
    ).toBe(true);
  });

  it("returns true for REQUEST_UPDATED message", () => {
    expect(
      isBorrowBookRealtimeMessage({
        type: "REQUEST_UPDATED",
        timestamp: "2026-01-01T00:00:00.000Z",
        requestId: "r1",
        bookId: "b1",
        userId: "u1",
        status: "PENDING",
      }),
    ).toBe(true);
  });

  it("returns false for invalid message", () => {
    expect(isBorrowBookRealtimeMessage({ random: "data" })).toBe(false);
  });

  it("returns false for null", () => expect(isBorrowBookRealtimeMessage(null)).toBe(false));
});

describe("isBorrowBookRealtimeEvent", () => {
  const validEvent: BorrowBookRealtimeEvent = {
    id: 1,
    event: "BOOK_UPDATED",
    message: {
      type: "BOOK_UPDATED",
      timestamp: "2026-05-24T12:00:00.000Z",
      bookId: "book-1",
      availableCount: 5,
      reservedCount: 2,
      borrowedCount: 3,
      version: 7,
    },
    publishedAt: "2026-05-24T12:00:00.000Z",
  };

  it("returns true for a fully valid event", () => {
    expect(isBorrowBookRealtimeEvent(validEvent)).toBe(true);
  });

  it("returns false for null", () => expect(isBorrowBookRealtimeEvent(null)).toBe(false));
  it("returns false for non-object values", () => {
    expect(isBorrowBookRealtimeEvent("string")).toBe(false);
    expect(isBorrowBookRealtimeEvent(42)).toBe(false);
  });

  it("returns false when id is not a number", () => {
    expect(isBorrowBookRealtimeEvent({ ...validEvent, id: "1" })).toBe(false);
  });

  it("returns false when event is not a string", () => {
    expect(isBorrowBookRealtimeEvent({ ...validEvent, event: 123 })).toBe(false);
  });

  it("returns false when publishedAt is not a string", () => {
    expect(isBorrowBookRealtimeEvent({ ...validEvent, publishedAt: 123 })).toBe(false);
  });

  it("returns false when message is invalid", () => {
    expect(isBorrowBookRealtimeEvent({ ...validEvent, message: { random: "data" } })).toBe(false);
  });

  it("returns true for REQUEST_UPDATED event type", () => {
    const requestEvent: BorrowBookRealtimeEvent = {
      id: 2,
      event: "REQUEST_UPDATED",
      message: {
        type: "REQUEST_UPDATED",
        timestamp: "2026-01-01T00:00:00.000Z",
        requestId: "r1",
        bookId: "b1",
        userId: "u1",
        status: "PENDING",
      },
      publishedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(isBorrowBookRealtimeEvent(requestEvent)).toBe(true);
  });
});

describe("encodeBorrowBookSseEvent", () => {
  it("encodes a BOOK_UPDATED event to SSE format", () => {
    const event: BorrowBookRealtimeEvent = {
      id: 42,
      event: "BOOK_UPDATED",
      message: {
        type: "BOOK_UPDATED",
        timestamp: "2026-05-24T12:00:00.000Z",
        bookId: "book-1",
        availableCount: 5,
        reservedCount: 2,
        borrowedCount: 3,
        version: 7,
      },
      publishedAt: "2026-05-24T12:00:00.000Z",
    };

    const result = encodeBorrowBookSseEvent(event);

    expect(result).toContain("id: 42");
    expect(result).toContain("event: BOOK_UPDATED");
    expect(result).toContain('"type":"BOOK_UPDATED"');
    expect(result).toContain('"bookId":"book-1"');
    expect(result.endsWith("\n\n")).toBe(true);
  });

  it("encodes a REQUEST_UPDATED event to SSE format", () => {
    const event: BorrowBookRealtimeEvent = {
      id: 7,
      event: "REQUEST_UPDATED",
      message: {
        type: "REQUEST_UPDATED",
        timestamp: "2026-05-24T12:30:00.000Z",
        requestId: "req-1",
        bookId: "book-1",
        userId: "user-1",
        status: "BORROWED",
      },
      publishedAt: "2026-05-24T12:30:00.000Z",
    };

    const result = encodeBorrowBookSseEvent(event);

    expect(result).toContain("id: 7");
    expect(result).toContain("event: REQUEST_UPDATED");
    expect(result).toContain('"requestId":"req-1"');
    expect(result.endsWith("\n\n")).toBe(true);
  });

  it("produces valid SSE with double newline termination", () => {
    const event: BorrowBookRealtimeEvent = {
      id: 1,
      event: "BOOK_UPDATED",
      message: {
        type: "BOOK_UPDATED",
        timestamp: "2026-01-01T00:00:00.000Z",
        bookId: "b1",
        availableCount: 1,
        reservedCount: 0,
        borrowedCount: 0,
        version: 1,
      },
      publishedAt: "2026-01-01T00:00:00.000Z",
    };

    const result = encodeBorrowBookSseEvent(event);
    const lines = result.split("\n");
    expect(lines[lines.length - 1]).toBe("");
    expect(lines[lines.length - 2]).toBe("");
  });
});

describe("module constants", () => {
  it("defines BORROW_BOOK_REALTIME_CHANNEL", () => {
    expect(BORROW_BOOK_REALTIME_CHANNEL).toBe("book:borrow:realtime");
  });
  it("defines BORROW_BOOK_REALTIME_REPLAY_KEY", () => {
    expect(BORROW_BOOK_REALTIME_REPLAY_KEY).toBe("book:borrow:realtime:recent");
  });
  it("defines BORROW_BOOK_REALTIME_SEQUENCE_KEY", () => {
    expect(BORROW_BOOK_REALTIME_SEQUENCE_KEY).toBe("book:borrow:realtime:sequence");
  });
  it("defines BORROW_BOOK_REALTIME_REPLAY_LIMIT as 250", () => {
    expect(BORROW_BOOK_REALTIME_REPLAY_LIMIT).toBe(250);
  });
});
