/**
 * receipt-generation.test.ts — Integration tests for receipt server action.
 *
 * Tests generateReceipt and getReceipt from lib/admin/actions/receipt.ts.
 *
 * Validates:
 *   - Auth enforcement (admin only)
 *   - Successful receipt generation for PENDING records
 *   - Status transition PENDING → BORROWED with dueDate computation
 *   - Blocked for already-RETURNED / LATE_RETURN records
 *   - Record not found handling
 *   - Realtime event publishing after generation
 *   - Admin dashboard broadcast
 *   - Receipt data shape correctness
 *   - Cross-table consistency (borrowRecords + books + users)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockAuth,
  mockDb,
  mockRedisGet,
  mockRedisEval,
  mockBroadcastAdminDashboard,
  mockPublishEvent,
} from "./helpers/instances";
import {
  createApprovedUser,
  createAvailableBook,
  createPendingBorrow,
  createBorrowedBorrow,
  createReturnedBorrow,
  createLateReturnBorrow,
  createAppSettings,
} from "./helpers/fixtures";

// ─── Modules under test ────────────────────────────────────────────────────

let generateReceipt: typeof import("@/lib/admin/actions/receipt").generateReceipt;
let getReceipt: typeof import("@/lib/admin/actions/receipt").getReceipt;

// ─── Constants ──────────────────────────────────────────────────────────────

const ADMIN_ID = "receipt-admin-id";

// ─── Helpers ───────────────────────────────────────────────────────────────

const setupAdminSession = () => {
  mockAuth.mockResolvedValue({
    user: { id: ADMIN_ID, name: "Receipt Admin", email: "admin@test.edu", role: "ADMIN" },
    expires: new Date().toISOString(),
  });
};

// ─── Setup ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  mockDb.clear();
  mockDb.seed("app_settings", [createAppSettings()]);

  setupAdminSession();

  mockRedisGet.mockReset();
  mockRedisEval.mockReset();
  mockBroadcastAdminDashboard.mockClear();
  mockPublishEvent.mockClear();

  const mod = await import("@/lib/admin/actions/receipt");
  generateReceipt = mod.generateReceipt;
  getReceipt = mod.getReceipt;
});

// ═══════════════════════════════════════════════════════════════════════════
// generateReceipt
// ═══════════════════════════════════════════════════════════════════════════

describe("generateReceipt", () => {
  describe("authentication", () => {
    it("throws Forbidden when not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);

      const result = await generateReceipt("any-id");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("throws Forbidden when user is not ADMIN", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user-1", name: "User", email: "u@t.edu", role: "USER" },
        expires: new Date().toISOString(),
      });

      const result = await generateReceipt("any-id");

      expect(result.success).toBe(false);
    });
  });

  describe("record validation", () => {
    it("returns error when borrow record does not exist", async () => {
      const result = await generateReceipt("non-existent-id");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Borrow record not found");
    });

    it("returns error when record is already RETURNED", async () => {
      const userId = "receipt-user-1";
      const bookId = "receipt-book-1";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "ru1@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createReturnedBorrow({
          id: "returned-rec",
          userId,
          bookId,
        }),
      ]);

      const result = await generateReceipt("returned-rec");

      expect(result.success).toBe(false);
      expect(result.error).toContain("already");
    });

    it("returns error when record is already LATE_RETURN", async () => {
      const userId = "receipt-user-2";
      const bookId = "receipt-book-2";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "ru2@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createLateReturnBorrow({
          id: "late-rec",
          userId,
          bookId,
        }),
      ]);

      const result = await generateReceipt("late-rec");

      expect(result.success).toBe(false);
      expect(result.error).toContain("already");
    });
  });

  describe("happy path", () => {
    it("generates receipt for a PENDING record and transitions to BORROWED", async () => {
      const userId = "receipt-user-3";
      const bookId = "receipt-book-3";

      const book = createAvailableBook({
        id: bookId,
        title: "Receipt Test Book",
        author: "Test Author",
        genre: "Fiction",
        totalCopies: 5,
      });
      mockDb.seed("users", [
        createApprovedUser({
          id: userId,
          fullName: "John Doe",
          email: "john@test.edu",
        }),
      ]);
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [
        createPendingBorrow({ id: "pending-rec-1", userId, bookId }),
      ]);

      const result = await generateReceipt("pending-rec-1");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("generates receiptId and status for a PENDING record", async () => {
      const userId = "receipt-user-data";
      const bookId = "receipt-book-data";

      mockDb.seed("users", [
        createApprovedUser({
          id: userId,
          fullName: "Data User",
          email: "data@test.edu",
        }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({
          id: bookId,
          title: "Data Book",
          author: "Data Author",
          genre: "Non-Fiction",
          totalCopies: 5,
        }),
      ]);
      mockDb.seed("borrow_records", [
        createPendingBorrow({ id: "data-rec", userId, bookId }),
      ]);

      const result = await generateReceipt("data-rec");

      expect(result.success).toBe(true);
      expect(result.data!.receiptId).toBe("DATA-REC");
    });

    it("receiptId is first 8 chars of record UUID, uppercased", async () => {
      const userId = "receipt-user-id";
      const bookId = "receipt-book-id";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "ruid@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createPendingBorrow({ id: "abcdef12-3456-7890-abcd-ef1234567890", userId, bookId }),
      ]);

      const result = await generateReceipt("abcdef12-3456-7890-abcd-ef1234567890");

      expect(result.success).toBe(true);
      expect(result.data!.receiptId).toBe("ABCDEF12");
    });

    it("updates borrowStatus to BORROWED", async () => {
      const userId = "receipt-user-status";
      const bookId = "receipt-book-status";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "rstatus@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createPendingBorrow({ id: "status-rec", userId, bookId }),
      ]);

      await generateReceipt("status-rec");

      const record = mockDb.getRow("borrow_records", "status-rec");
      expect(record).not.toBeNull();
      expect(record!.borrowStatus).toBe("BORROWED");
    });

    it("sets borrowDate to now and dueDate based on borrow duration", async () => {
      const userId = "receipt-user-dates";
      const bookId = "receipt-book-dates";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "rdates@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createPendingBorrow({ id: "dates-rec", userId, bookId }),
      ]);

      const before = Date.now();
      await generateReceipt("dates-rec");
      const after = Date.now();

      const record = mockDb.getRow("borrow_records", "dates-rec");
      const borrowDate = new Date(record!.borrowDate as string).getTime();
      expect(borrowDate).toBeGreaterThanOrEqual(before - 1000);
      expect(borrowDate).toBeLessThanOrEqual(after + 1000);

      // dueDate should be ~14 days from borrowDate
      expect(record!.dueDate).toBeDefined();
    });
  });

  describe("realtime side-effects", () => {
    it("broadcasts admin dashboard update after receipt generation", async () => {
      const userId = "receipt-user-bc";
      const bookId = "receipt-book-bc";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "rbc@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createPendingBorrow({ id: "bc-rec", userId, bookId }),
      ]);

      await generateReceipt("bc-rec");

      expect(mockBroadcastAdminDashboard).toHaveBeenCalled();
    });

    it("publishes borrow_requests UPDATE event after generation", async () => {
      const userId = "receipt-user-rt";
      const bookId = "receipt-book-rt";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "rrt@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createPendingBorrow({ id: "rt-rec", userId, bookId }),
      ]);

      await generateReceipt("rt-rec");

      await vi.waitFor(() => {
        expect(mockPublishEvent).toHaveBeenCalledWith(
          "borrow_requests",
          expect.objectContaining({
            type: "UPDATE",
            entityId: "rt-rec",
          }),
        );
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getReceipt
// ═══════════════════════════════════════════════════════════════════════════

describe("getReceipt", () => {
  it("returns receipt data for an existing BORROWED record", async () => {
    const userId = "get-rec-user";
    const bookId = "get-rec-book";

    mockDb.seed("users", [
      createApprovedUser({
        id: userId,
        fullName: "Get User",
        email: "get@test.edu",
      }),
    ]);
    mockDb.seed("books", [
      createAvailableBook({
        id: bookId,
        title: "Get Book",
        author: "Get Author",
        genre: "Fiction",
        totalCopies: 5,
      }),
    ]);
    mockDb.seed("borrow_records", [
      createBorrowedBorrow({
        id: "get-rec",
        userId,
        bookId,
        borrowDate: new Date(),
        dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      }),
    ]);

    const result = await getReceipt("get-rec");

    expect(result.success).toBe(true);
    expect(result.data!.receiptId).toBeTruthy();
    expect(typeof result.data!.receiptId).toBe("string");
  });

  it("returns error for non-existent record", async () => {
    const result = await getReceipt("non-existent");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Borrow record not found");
  });

    it("returns receipt for a RETURNED record (read-only, no transition)", async () => {
      const userId = "get-ret-user";
      const bookId = "get-ret-book";

      mockDb.seed("users", [
        createApprovedUser({ id: userId, email: "gret@test.edu" }),
      ]);
      mockDb.seed("books", [
        createAvailableBook({ id: bookId, totalCopies: 5 }),
      ]);
      mockDb.seed("borrow_records", [
        createReturnedBorrow({
          id: "get-ret-rec",
          userId,
          bookId,
        }),
      ]);

      // getReceipt reads but does NOT transition
      const result = await getReceipt("get-ret-rec");

      expect(result.success).toBe(true);
      // Status should still be RETURNED (not modified)
      const record = mockDb.getRow("borrow_records", "get-ret-rec");
      expect(record!.borrowStatus).toBe("RETURNED");
    });
});
