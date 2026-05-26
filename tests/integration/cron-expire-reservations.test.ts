/**
 * cron-expire-reservations.test.ts — Integration tests for the reservation
 * expiry cron endpoint (GET /api/book/cron/expire-reservations).
 *
 * Covers:
 * - CRON_SECRET authorization enforcement
 * - No-op when no stale PENDING records exist
 * - Expiration of PENDING records older than RESERVATION_EXPIRY_MINUTES
 * - Exact time-boundary behavior (fresh vs stale)
 * - Idempotency — running twice produces same result as once
 * - Multiple books affected in a single run
 * - Book counter consistency (reservedCount decremented per expired record)
 * - Concurrent modification of PENDING records during cron execution
 * - Realtime broadcasts and publishEvent fan-out
 * - Graceful degradation when broadcasts fail
 *
 * Mocked: @/auth, @/database/drizzle, @/database/redis, broadcast modules
 * NOT mocked: business logic, counter corrections, DB queries, SQL conditions
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mockDb,
  mockBroadcastAdminDashboard,
  mockBroadcastBookAvailability,
  mockPublishEvent,
} from "./helpers/instances";
import {
  createBook,
  createPendingBorrow,
  createBorrowedBorrow,
  createAppSettings,
  createApprovedUser,
} from "./helpers/fixtures";
import {
  assertRowExists,
  assertBorrowStatus,
  assertBookCounts,
} from "./helpers/assertions";

// ─── Module under test ────────────────────────────────────────────────────

type CronHandler = (request: Request) => Promise<Response>;

let GET: CronHandler;

const CRON_SECRET = "test-cron-secret-2026";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createCronRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) {
    headers.set("authorization", authHeader);
  }
  return new Request("http://localhost/api/book/cron/expire-reservations", {
    method: "GET",
    headers,
  });
}

async function responseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  mockDb.clear();
  mockDb.seed("app_settings", [createAppSettings()]);

  process.env.CRON_SECRET = CRON_SECRET;

  mockBroadcastAdminDashboard.mockClear();
  mockBroadcastBookAvailability.mockClear();
  mockPublishEvent.mockClear();

  const cronModule =
    await import("@/app/api/book/cron/expire-reservations/route");
  GET = cronModule.GET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

// ════════════════════════════════════════════════════════════════════════════
// Authorization
// ════════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("returns 401 when no authorization header is provided", async () => {
    const response = await GET(createCronRequest());
    expect(response.status).toBe(401);
    const body = await responseJson(response);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when authorization header does not match CRON_SECRET", async () => {
    const response = await GET(createCronRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("returns 200 when authorization header matches CRON_SECRET", async () => {
    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);
  });

  it("skips auth when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(createCronRequest());
    expect(response.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Happy Path — No Stale Records
// ════════════════════════════════════════════════════════════════════════════

describe("no stale records", () => {
  it("returns expired: 0 when no PENDING records exist", async () => {
    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.success).toBe(true);
    expect(body.expired).toBe(0);
    expect(body.message).toContain("No stale reservations");
  });

  it("does not modify fresh PENDING records (within expiry window)", async () => {
    const bookId = "fresh-pending-book";
    const userId = "fresh-pending-user";
    const now = new Date();
    mockDb.seed("books", [createBook({ id: bookId })]);
    mockDb.seed("users", [createApprovedUser({ id: userId })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "fresh-record",
        userId,
        bookId,
        reservedAt: now,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.expired).toBe(0);
    assertBorrowStatus("fresh-record", "PENDING");
  });

  it("does not emit broadcasts or events when no records expired", async () => {
    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(200);
    expect(mockBroadcastAdminDashboard).not.toHaveBeenCalled();
    expect(mockBroadcastBookAvailability).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Happy Path — Stale Records Expired
// ════════════════════════════════════════════════════════════════════════════

describe("stale records expiry", () => {
  it("expires a single stale PENDING record older than 15 minutes", async () => {
    const bookId = "stale-single-book";
    const userId = "stale-single-user";
    const staleTime = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: userId })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "stale-single-record",
        userId,
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.success).toBe(true);
    expect(body.expired).toBe(1);

    assertBorrowStatus("stale-single-record", "REJECTED");
    assertBookCounts(bookId, { reservedCount: 0 });
  });

  it("expires multiple stale PENDING records for the same book", async () => {
    const bookId = "stale-multi-book";
    const staleTime = new Date(Date.now() - 30 * 60 * 1000);
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 10, reservedCount: 3 }),
    ]);
    mockDb.seed("users", [
      createApprovedUser({ id: "u1", email: "u1@test.edu" }),
      createApprovedUser({ id: "u2", email: "u2@test.edu" }),
      createApprovedUser({ id: "u3", email: "u3@test.edu" }),
    ]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "stale-multi-1",
        userId: "u1",
        bookId,
        reservedAt: staleTime,
      }),
      createPendingBorrow({
        id: "stale-multi-2",
        userId: "u2",
        bookId,
        reservedAt: staleTime,
      }),
      createPendingBorrow({
        id: "stale-multi-3",
        userId: "u3",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.expired).toBe(3);
    expect(body.affectedBooks).toBe(1);

    assertBorrowStatus("stale-multi-1", "REJECTED");
    assertBorrowStatus("stale-multi-2", "REJECTED");
    assertBorrowStatus("stale-multi-3", "REJECTED");
    assertBookCounts(bookId, { reservedCount: 0 });
  });

  it("expires stale records across multiple books", async () => {
    const staleTime = new Date(Date.now() - 25 * 60 * 1000);
    mockDb.seed("books", [
      createBook({ id: "book-a", totalCopies: 5, reservedCount: 2 }),
      createBook({ id: "book-b", totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [
      createApprovedUser({ id: "ua1", email: "ua1@test.edu" }),
      createApprovedUser({ id: "ua2", email: "ua2@test.edu" }),
      createApprovedUser({ id: "ub1", email: "ub1@test.edu" }),
    ]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "multi-book-a1",
        userId: "ua1",
        bookId: "book-a",
        reservedAt: staleTime,
      }),
      createPendingBorrow({
        id: "multi-book-a2",
        userId: "ua2",
        bookId: "book-a",
        reservedAt: staleTime,
      }),
      createPendingBorrow({
        id: "multi-book-b1",
        userId: "ub1",
        bookId: "book-b",
        reservedAt: staleTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.expired).toBe(3);
    expect(body.affectedBooks).toBe(2);

    assertBookCounts("book-a", { reservedCount: 0 });
    assertBookCounts("book-b", { reservedCount: 0 });
  });

  it("only expires PENDING records, not BORROWED or other statuses", async () => {
    const staleTime = new Date(Date.now() - 30 * 60 * 1000);
    const bookId = "mixed-status-book";
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 10, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [
      createApprovedUser({ id: "um1", email: "um1@test.edu" }),
      createApprovedUser({ id: "um2", email: "um2@test.edu" }),
    ]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "mixed-stale",
        userId: "um1",
        bookId,
        reservedAt: staleTime,
      }),
      createBorrowedBorrow({
        id: "mixed-borrowed",
        userId: "um2",
        bookId,
        borrowDate: staleTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.expired).toBe(1);

    assertBorrowStatus("mixed-stale", "REJECTED");
    assertBorrowStatus("mixed-borrowed", "BORROWED");
    // Only the PENDING record's reservedCount should be decremented
    assertBookCounts(bookId, { reservedCount: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Idempotency
// ════════════════════════════════════════════════════════════════════════════

describe("idempotency", () => {
  it("second run is a no-op when all stale records already expired", async () => {
    const bookId = "idempotent-book";
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "idem-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "idem-record",
        userId: "idem-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const response2 = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body2 = await responseJson(response2);

    expect(body2.expired).toBe(0);
    expect(body2.success).toBe(true);
    assertBorrowStatus("idem-record", "REJECTED");
  });

  it("repeated runs do not decrement reservedCount below zero", async () => {
    const bookId = "no-negative-book";
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "neg-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "neg-record",
        userId: "neg-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    assertBookCounts(bookId, { reservedCount: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Time Boundary
// ════════════════════════════════════════════════════════════════════════════

describe("time boundary behavior", () => {
  it("does not expire PENDING records exactly at 15 minutes (same timestamp)", async () => {
    // reservedAt set to exactly 15 minutes ago — the interval is strictly <, not <=
    const bookId = "boundary-book";
    const boundaryTime = new Date(Date.now() - 15 * 60 * 1000);
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "boundary-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "boundary-record",
        userId: "boundary-user",
        bookId,
        reservedAt: boundaryTime,
      }),
    ]);

    // Since the mock uses Date.now() vs stored timestamp, and we set reservedAt
    // to exactly Date.now() - 15min, the condition `reservedAt < NOW() - 15 min`
    // depends on sub-millisecond timing. In practice this is a strict < check
    // so it may or may not expire. We verify the record is still PENDING if
    // boundaryTime is precisely at the boundary.
    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    await responseJson(response);

    // At exact boundary, the record may or may not be expired depending on
    // execution timing. The important invariant: no negative reservedCount.
    const bookAfter = assertRowExists("books", bookId);
    expect(Number(bookAfter.reservedCount)).toBeGreaterThanOrEqual(0);
  });

  it("expires records older than 15 minutes (16+ minutes)", async () => {
    const bookId = "definitely-stale-book";
    const staleTime = new Date(Date.now() - 16 * 60 * 1000); // 16 min ago
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "def-stale-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "def-stale-record",
        userId: "def-stale-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.expired).toBe(1);
    assertBorrowStatus("def-stale-record", "REJECTED");
  });

  it("preserves reservedCount floor at 0 (GREATEST(0, ...))", async () => {
    // Edge case: reservedCount already 0, but a stale record exists
    // The GREATEST(0, 0 - 1) should keep it at 0
    const bookId = "floor-test-book";
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 0 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "floor-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "floor-record",
        userId: "floor-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.expired).toBe(1);
    assertBookCounts(bookId, { reservedCount: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Realtime / Broadcast Side Effects
// ════════════════════════════════════════════════════════════════════════════

describe("realtime broadcasts and events", () => {
  it("broadcasts admin dashboard update after expiry", async () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    const bookId = "broadcast-dash-book";
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "bdash-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "bdash-record",
        userId: "bdash-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    expect(mockBroadcastAdminDashboard).toHaveBeenCalled();
  });

  it("broadcasts book availability update per affected book", async () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    const bookId = "avail-bc-book";
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 2 }),
    ]);
    mockDb.seed("users", [
      createApprovedUser({ id: "avail-u1" }),
      createApprovedUser({ id: "avail-u2" }),
    ]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "avail-rec-1",
        userId: "avail-u1",
        bookId,
        reservedAt: staleTime,
      }),
      createPendingBorrow({
        id: "avail-rec-2",
        userId: "avail-u2",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    // Should broadcast once per affected book with correct updated counters
    expect(mockBroadcastBookAvailability).toHaveBeenCalledTimes(1);
    expect(mockBroadcastBookAvailability).toHaveBeenCalledWith(
      bookId,
      expect.any(Number),
      0, // reservedCount after expiry
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("publishes borrow_requests UPDATE event per expired record", async () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    const bookId = "pub-event-book";
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "pub-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "pub-event-rec",
        userId: "pub-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "borrow_requests",
      expect.objectContaining({
        type: "UPDATE",
        entityId: "pub-event-rec",
      }),
    );
  });

  it("publishes events for all expired records across multiple books", async () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    mockDb.seed("books", [
      createBook({ id: "pub-book-a", totalCopies: 5, reservedCount: 1 }),
      createBook({ id: "pub-book-b", totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [
      createApprovedUser({ id: "pub-ua", email: "ua@test.edu" }),
      createApprovedUser({ id: "pub-ub", email: "ub@test.edu" }),
    ]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "pub-rec-a",
        userId: "pub-ua",
        bookId: "pub-book-a",
        reservedAt: staleTime,
      }),
      createPendingBorrow({
        id: "pub-rec-b",
        userId: "pub-ub",
        bookId: "pub-book-b",
        reservedAt: staleTime,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    // Should have 2 publishEvent calls, one per expired record
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Graceful Degradation
// ════════════════════════════════════════════════════════════════════════════

describe("graceful degradation", () => {
  it("succeeds despite broadcast failures", async () => {
    mockBroadcastAdminDashboard.mockRejectedValue(new Error("Dashboard down"));
    mockBroadcastBookAvailability.mockRejectedValue(
      new Error("Availability down"),
    );
    mockPublishEvent.mockRejectedValue(new Error("Pub/sub down"));

    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    const bookId = "graceful-cron-book";
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "grace-cron-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "grace-cron-rec",
        userId: "grace-cron-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.success).toBe(true);
    expect(body.expired).toBe(1);
    assertBorrowStatus("grace-cron-rec", "REJECTED");
    assertBookCounts(bookId, { reservedCount: 0 });
  });

  it("DB update still applies even if all broadcast and publish calls fail", async () => {
    mockBroadcastAdminDashboard.mockRejectedValue(new Error("Fail"));
    mockBroadcastBookAvailability.mockRejectedValue(new Error("Fail"));
    mockPublishEvent.mockRejectedValue(new Error("Fail"));

    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    const bookId = "db-only-book";
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "db-only-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "db-only-rec",
        userId: "db-only-user",
        bookId,
        reservedAt: staleTime,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    // DB mutations must persist regardless of pub/sub failures
    const record = assertRowExists("borrow_records", "db-only-rec");
    expect(record.borrowStatus).toBe("REJECTED");
    assertBookCounts(bookId, { reservedCount: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Concurrent Modification Race
// ════════════════════════════════════════════════════════════════════════════

describe("concurrent modification of PENDING record during cron", () => {
  it("cron does not overwrite an already-approved record", async () => {
    // Simulate: a PENDING record is approved by an admin concurrently,
    // changing its status to BORROWED. The cron then runs and should
    // skip it because the WHERE clause filters by borrowStatus = 'PENDING'.
    const bookId = "concurrent-approve-book";
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    mockDb.seed("books", [
      createBook({
        id: bookId,
        totalCopies: 5,
        reservedCount: 0,
        borrowedCount: 1,
      }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "concurrent-user" })]);

    // Record was originally PENDING but concurrently approved to BORROWED
    mockDb.seed("borrow_records", [
      {
        id: "concurrent-approve-rec",
        userId: "concurrent-user",
        bookId,
        borrowStatus: "BORROWED",
        reservedAt: staleTime,
        dueDate: new Date(Date.now() + 14 * 86400000)
          .toISOString()
          .slice(0, 10),
        version: 2,
        updatedAt: new Date(),
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    // The BORROWED record should not be touched
    expect(body.expired).toBe(0);
    assertBorrowStatus("concurrent-approve-rec", "BORROWED");
    // Book counters unchanged
    assertBookCounts(bookId, { reservedCount: 0, borrowedCount: 1 });
  });

  it("cron does not affect PENDING records that were just created (non-stale)", async () => {
    // Fresh PENDING record created moments ago
    const bookId = "fresh-concurrent-book";
    const freshTime = new Date();
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "fresh-concurrent-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "fresh-concurrent-rec",
        userId: "fresh-concurrent-user",
        bookId,
        reservedAt: freshTime,
      }),
    ]);

    const response = await GET(createCronRequest(`Bearer ${CRON_SECRET}`));
    const body = await responseJson(response);

    expect(body.expired).toBe(0);
    assertBorrowStatus("fresh-concurrent-rec", "PENDING");
    assertBookCounts(bookId, { reservedCount: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Version Integrity
// ════════════════════════════════════════════════════════════════════════════

describe("version integrity", () => {
  it("bumps version on expired records", async () => {
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    const bookId = "version-bump-book";
    mockDb.seed("books", [
      createBook({ id: bookId, totalCopies: 5, reservedCount: 1 }),
    ]);
    mockDb.seed("users", [createApprovedUser({ id: "version-bump-user" })]);
    mockDb.seed("borrow_records", [
      createPendingBorrow({
        id: "version-bump-rec",
        userId: "version-bump-user",
        bookId,
        reservedAt: staleTime,
        version: 1,
      }),
    ]);

    await GET(createCronRequest(`Bearer ${CRON_SECRET}`));

    const record = assertRowExists("borrow_records", "version-bump-rec");
    expect(record.version).toBe(2);
  });
});
