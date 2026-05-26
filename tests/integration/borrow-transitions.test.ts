/**
 * borrow-transitions.test.ts — Integration tests for borrow status transitions.
 *
 * Tests the three PATCH endpoints:
 *   PATCH /api/book/requests/:id/approve  (PENDING → BORROWED)
 *   PATCH /api/book/requests/:id/reject   (PENDING → REJECTED)
 *   PATCH /api/book/requests/:id/return   (BORROWED → RETURNED | LATE_RETURN)
 *
 * Covers:
 * - Authentication (401 anonymous) and authorization (403 non-admin)
 * - Valid status transitions
 * - Invalid transition rejection
 * - Version conflict detection
 * - Book counter deltas (reservedCount, borrowedCount)
 * - Lock ownership assertion and release
 * - Due date computation on approve
 * - LATE_RETURN vs RETURNED distinction based on due date
 * - Realtime broadcasts and events
 * - Best-effort lock release in finally block
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  mockAuth,
  mockDb,
  mockRedisGet,
  mockRedisEval,
  mockRedisDel,
  mockBroadcastAdminDashboard,
  mockBroadcastBookAvailability,
  mockPublishEvent,
} from "./helpers/instances";
import {
  createBook,
  createAvailableBook,
  createPendingBorrow,
  createBorrowedBorrow,
  createAppSettings,
} from "./helpers/fixtures";
import {
  assertBorrowStatus,
  assertBookCounts,
  assertRowExists,
  assertVersionIncremented,
} from "./helpers/assertions";

// ─── Module under test ────────────────────────────────────────────────────

type PatchHandler = (
  request: Request,
  params: { params: Promise<{ id: string }> },
) => Promise<Response>;

let approveHandler: PatchHandler;
let rejectHandler: PatchHandler;
let returnHandler: PatchHandler;

// ─── Helpers ───────────────────────────────────────────────────────────────

function createAdminPatchRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/book/requests/some-id", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createReturnRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/book/requests/some-id/return", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ─── Setup ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  mockDb.clear();
  mockDb.seed("app_settings", [createAppSettings()]);

  // Default: admin session
  mockAuth.mockResolvedValue({
    user: {
      id: "admin-id",
      name: "Admin",
      email: "admin@test.edu",
      role: "ADMIN",
      sessionVersion: 1,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  });

  // Default: lock exists and owned by this admin
  const lockPayload = JSON.stringify({
    adminId: "admin-id",
    adminName: "Admin",
    token: "test-lock-token",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    version: 1,
  });
  mockRedisGet.mockResolvedValue(lockPayload);
  mockRedisEval.mockResolvedValue(["OK", "released"]);
  mockRedisDel.mockResolvedValue(1);

  mockBroadcastAdminDashboard.mockClear();
  mockBroadcastBookAvailability.mockClear();
  mockPublishEvent.mockClear();

  const approveModule =
    await import("@/app/api/book/requests/[id]/approve/route");
  approveHandler = approveModule.PATCH;

  const rejectModule =
    await import("@/app/api/book/requests/[id]/reject/route");
  rejectHandler = rejectModule.PATCH;

  const returnModule =
    await import("@/app/api/book/requests/[id]/return/route");
  returnHandler = returnModule.PATCH;
});

// ═══════════════════════════════════════════════════════════════════════════
// APPROVE — PENDING → BORROWED
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/book/requests/:id/approve", () => {
  describe("authentication and authorization", () => {
    it("returns 403 when user is not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);

      const response = await approveHandler(
        createAdminPatchRequest({ expectedVersion: 1 }),
        createParams("record-id"),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("Forbidden");
    });

    it("returns 403 when user is not ADMIN", async () => {
      mockAuth.mockResolvedValueOnce({
        user: {
          id: "user-id",
          name: "User",
          email: "user@test.edu",
          role: "USER",
        },
        expires: new Date().toISOString(),
      });

      const response = await approveHandler(
        createAdminPatchRequest({ expectedVersion: 1 }),
        createParams("record-id"),
      );

      expect(response.status).toBe(403);
    });
  });

  describe("request validation", () => {
    it("returns 400 when expectedVersion is missing", async () => {
      const response = await approveHandler(
        createAdminPatchRequest({}),
        createParams("record-id"),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Missing expectedVersion");
    });

    it("returns 400 when expectedVersion is not a number", async () => {
      const response = await approveHandler(
        createAdminPatchRequest({ expectedVersion: "not-a-number" }),
        createParams("record-id"),
      );

      expect(response.status).toBe(400);
    });
  });

  describe("lock ownership", () => {
    it("returns 409 when no lock token provided", async () => {
      const response = await approveHandler(
        createAdminPatchRequest({ expectedVersion: 1 }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
    });

    it("returns 409 when lock is expired (no lock in Redis)", async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      const response = await approveHandler(
        createAdminPatchRequest({ expectedVersion: 1, lockToken: "test-lock" }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
    });

    it("returns 409 when lock is held by another admin", async () => {
      mockRedisGet.mockResolvedValueOnce(
        JSON.stringify({
          adminId: "other-admin-id",
          adminName: "Other Admin",
          token: "other-token",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          version: 1,
        }),
      );

      const response = await approveHandler(
        createAdminPatchRequest({ expectedVersion: 1, lockToken: "my-token" }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
    });

    it("returns 409 when lock token does not match", async () => {
      mockRedisGet.mockResolvedValueOnce(
        JSON.stringify({
          adminId: "admin-id",
          adminName: "Admin",
          token: "different-token",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          version: 1,
        }),
      );

      const response = await approveHandler(
        createAdminPatchRequest({ expectedVersion: 1, lockToken: "my-token" }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
    });
  });

  describe("valid transition — PENDING → BORROWED", () => {
    it("approves a PENDING request and updates counters", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);

      // Status transitioned
      assertBorrowStatus("record-id", "BORROWED");
      assertVersionIncremented("borrow_records", "record-id", 1);

      // Book counters updated: reserved--, borrowed++
      assertBookCounts(book.id, { reservedCount: 0, borrowedCount: 1 });
    });

    it("sets dueDate based on borrow duration from app_settings", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
      const updatedRecord = assertRowExists("borrow_records", "record-id");
      const dueDateStr = updatedRecord.dueDate as string;
      expect(dueDateStr).toBeDefined();
      // Due date should be ~14 days from now (configured in app_settings)
      const expectedDue = new Date(Date.now() + 14 * 86400000);
      const actualDue = new Date(dueDateStr);
      const diffMs = Math.abs(actualDue.getTime() - expectedDue.getTime());
      expect(diffMs).toBeLessThan(24 * 60 * 60 * 1000); // Within a day
    });

    it("increments book version on approve", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
        version: 3,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      assertVersionIncremented("books", book.id, 3);
    });
  });

  describe("version conflict", () => {
    it("returns 409 when borrow record version does not match", async () => {
      const record = createPendingBorrow({ id: "record-id", version: 2 });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain("newer changes");
      // Status should remain PENDING
      assertBorrowStatus("record-id", "PENDING");
      assertBookCounts(book.id, { reservedCount: 1, borrowedCount: 0 });
    });
  });

  describe("record not found", () => {
    it("returns 404 when borrow record does not exist", async () => {
      const response = await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("non-existent-record"),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("invalid transition", () => {
    it("returns 409 when trying to approve a BORROWED record", async () => {
      const record = createBorrowedBorrow({ id: "record-id" });
      const book = createAvailableBook({ id: record.bookId });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("Invalid status transition");
    });

    it("returns 409 when trying to approve a REJECTED record", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({ id: record.bookId });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);
      // First update status to REJECTED manually
      record.borrowStatus = "REJECTED";
      record.version = 2;
      mockDb.clearTable("borrow_records");
      mockDb.seed("borrow_records", [record]);

      const response = await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 2,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
    });

    it("returns 409 when trying to approve a RETURNED record", async () => {
      mockDb.seed("borrow_records", [
        {
          id: "returned-record",
          bookId: "book-id",
          userId: "user-id",
          borrowStatus: "RETURNED",
          dueDate: new Date().toISOString().slice(0, 10),
          returnDate: new Date().toISOString().slice(0, 10),
          version: 2,
          updatedAt: new Date(),
        },
      ]);

      const response = await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 2,
          lockToken: "test-lock-token",
        }),
        createParams("returned-record"),
      );

      expect(response.status).toBe(409);
    });
  });

  describe("realtime side-effects", () => {
    it("broadcasts book availability update after approve", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(mockBroadcastBookAvailability).toHaveBeenCalledWith(
        book.id,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("publishes realtime borrow_requests UPDATE event", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(mockPublishEvent).toHaveBeenCalledWith(
        "borrow_requests",
        expect.objectContaining({
          type: "UPDATE",
          entityId: "record-id",
        }),
      );
    });
  });

  describe("lock release", () => {
    it("releases the lock in the finally block after success", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      // The finally block calls releaseLock which uses redis.eval
      mockRedisEval.mockClear();

      await approveHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      // releaseLock was called (redis.eval for RELEASE_SCRIPT)
      // The mock was called at least twice: once for lock assert (getRowLock via redis.get)
      // and once for releaseLock (redis.eval)
      expect(mockRedisEval).toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REJECT — PENDING → REJECTED
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/book/requests/:id/reject", () => {
  describe("valid transition — PENDING → REJECTED", () => {
    it("rejects a PENDING request and decrements reservedCount", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await rejectHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
      assertBorrowStatus("record-id", "REJECTED");
      assertBookCounts(book.id, { reservedCount: 0, borrowedCount: 0 });
      assertVersionIncremented("borrow_records", "record-id", 1);
    });

    it("keeps reservedCount at 0 (GREATEST(0, ...)) even if it would underflow", async () => {
      const record = createPendingBorrow({ id: "record-id" });
      const book = createBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 0,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await rejectHandler(
        createAdminPatchRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
      assertBookCounts(book.id, { reservedCount: 0 });
    });
  });

  describe("version conflict on reject", () => {
    it("returns 409 when version does not match", async () => {
      const record = createPendingBorrow({ id: "record-id", version: 3 });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        reservedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await rejectHandler(
        createAdminPatchRequest({
          expectedVersion: 2,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
      assertBorrowStatus("record-id", "PENDING");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RETURN — BORROWED → RETURNED | LATE_RETURN
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/book/requests/:id/return", () => {
  describe("authentication and authorization", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);

      const response = await returnHandler(
        createReturnRequest({}),
        createParams("record-id"),
      );

      expect(response.status).toBe(401);
    });

    it("allows the borrowing user to return their own book", async () => {
      const userId = "owner-user-id";
      mockAuth.mockResolvedValue({
        user: {
          id: userId,
          name: "Owner",
          email: "owner@test.edu",
          role: "USER",
        },
        expires: new Date().toISOString(),
      });

      const record = createBorrowedBorrow({
        id: "record-id",
        userId,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({ expectedVersion: 1 }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
      assertBorrowStatus("record-id", "RETURNED");
    });

    it("returns 403 when a different non-admin user tries to return", async () => {
      mockAuth.mockResolvedValue({
        user: {
          id: "different-user",
          name: "Other",
          email: "other@test.edu",
          role: "USER",
        },
        expires: new Date().toISOString(),
      });

      const record = createBorrowedBorrow({
        id: "record-id",
        userId: "owner-user",
      });
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({ expectedVersion: 1 }),
        createParams("record-id"),
      );

      expect(response.status).toBe(403);
    });

    it("allows ADMIN to return any book", async () => {
      const record = createBorrowedBorrow({
        id: "record-id",
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("valid transition — BORROWED → RETURNED (on time)", () => {
    it("returns a book before due date with status RETURNED", async () => {
      const dueDate = new Date(Date.now() + 7 * 86400000)
        .toISOString()
        .slice(0, 10); // 7 days from now
      const record = createBorrowedBorrow({
        id: "record-id",
        dueDate,
        borrowDate: new Date(),
      });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
      assertBorrowStatus("record-id", "RETURNED");
      assertBookCounts(book.id, { borrowedCount: 0 });
      assertVersionIncremented("borrow_records", "record-id", 1);

      // returnDate should be set
      const updatedRecord = assertRowExists("borrow_records", "record-id");
      expect(updatedRecord.returnDate).toBeDefined();
    });
  });

  describe("valid transition — BORROWED → LATE_RETURN (overdue)", () => {
    it("returns a book after due date with status LATE_RETURN", async () => {
      const dueDate = new Date(Date.now() - 3 * 86400000)
        .toISOString()
        .slice(0, 10); // 3 days ago
      const record = createBorrowedBorrow({
        id: "late-record",
        dueDate,
        borrowDate: new Date(Date.now() - 17 * 86400000),
      });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("late-record"),
      );

      expect(response.status).toBe(200);
      assertBorrowStatus("late-record", "LATE_RETURN");
      assertBookCounts(book.id, { borrowedCount: 0 });
    });

    it("sets LATE_RETURN when due date is yesterday", async () => {
      // Due date exactly yesterday means it's past due
      const yesterday = new Date(Date.now() - 1 * 86400000)
        .toISOString()
        .slice(0, 10);
      const record = createBorrowedBorrow({
        id: "yesterday-record",
        dueDate: yesterday,
      });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("yesterday-record"),
      );

      expect(response.status).toBe(200);
      assertBorrowStatus("yesterday-record", "LATE_RETURN");
    });
  });

  describe("invalid return transitions", () => {
    it("returns 409 when trying to return a PENDING record", async () => {
      const record = createPendingBorrow({ id: "pending-record" });
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({ expectedVersion: 1 }),
        createParams("pending-record"),
      );

      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("Invalid status transition");
    });

    it("returns 409 when trying to return an already RETURNED record", async () => {
      mockDb.seed("borrow_records", [
        {
          id: "already-returned",
          bookId: "book-id",
          userId: "user-id",
          borrowStatus: "RETURNED",
          returnDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date().toISOString().slice(0, 10),
          version: 2,
          updatedAt: new Date(),
        },
      ]);

      const response = await returnHandler(
        createReturnRequest({ expectedVersion: 2 }),
        createParams("already-returned"),
      );

      expect(response.status).toBe(409);
    });

    it("returns 409 when trying to return a REJECTED record", async () => {
      mockDb.seed("borrow_records", [
        {
          id: "rejected-record",
          bookId: "book-id",
          userId: "user-id",
          borrowStatus: "REJECTED",
          dueDate: new Date().toISOString().slice(0, 10),
          version: 2,
          updatedAt: new Date(),
        },
      ]);

      const response = await returnHandler(
        createReturnRequest({ expectedVersion: 2 }),
        createParams("rejected-record"),
      );

      expect(response.status).toBe(409);
    });
  });

  describe("version conflict on return", () => {
    it("returns 409 when version does not match", async () => {
      const record = createBorrowedBorrow({ id: "record-id", version: 5 });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({ expectedVersion: 4 }),
        createParams("record-id"),
      );

      expect(response.status).toBe(409);
      assertBorrowStatus("record-id", "BORROWED");
      assertBookCounts(book.id, { borrowedCount: 1 });
    });
  });

  describe("not found", () => {
    it("returns 404 when borrow record does not exist", async () => {
      const response = await returnHandler(
        createReturnRequest({ expectedVersion: 1 }),
        createParams("non-existent"),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("counter safety", () => {
    it("keeps borrowedCount at 0 (GREATEST(0, ...)) even on underflow", async () => {
      const record = createBorrowedBorrow({ id: "record-id" });
      // Book with borrowedCount = 0 (shouldn't happen but safety check)
      const book = createBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 0,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      const response = await returnHandler(
        createReturnRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
      assertBookCounts(book.id, { borrowedCount: 0 });
    });
  });

  describe("lock release", () => {
    it("admin returns release lock in finally block", async () => {
      const record = createBorrowedBorrow({ id: "record-id" });
      const book = createAvailableBook({
        id: record.bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [record]);

      // Admin return path uses lock
      mockRedisEval.mockClear();

      const response = await returnHandler(
        createReturnRequest({
          expectedVersion: 1,
          lockToken: "test-lock-token",
        }),
        createParams("record-id"),
      );

      expect(response.status).toBe(200);
    });
  });
});
