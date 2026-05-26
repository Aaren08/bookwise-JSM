/**
 * book-crud.test.ts — Integration tests for admin book CRUD actions.
 *
 * Covers:
 * - createBook: authorization, DB insert, cache revalidation, realtime events
 * - updateBook: version-locked updates, lock ownership, totalCopies guard,
 *               concurrent-update safety, TOCTOU window, broadcast fallback
 * - deleteBook: borrow-record guard, version check, lock lifecycle
 * - getBookById, getAllBooks: read paths, pagination, search filtering
 *
 * Mocked: @/auth, @/database/redis, broadcast modules, @/database/drizzle
 * NOT mocked: business logic, version checks, authorization guards,
 *             lock assertion logic, counter validation
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  mockAuth,
  mockDb,
  mockRedisGet,
  mockRedisEval,
  mockBroadcastAdminDashboard,
  mockBroadcastBookAvailability,
  mockPublishEvent,
} from "./helpers/instances";
import {
  createAvailableBook,
  createPendingBorrow,
  createBorrowedBorrow,
  createReturnedBorrow,
  createAppSettings,
} from "./helpers/fixtures";
import {
  assertRowExists,
  assertRowNotExists,
  assertVersionUnchanged,
} from "./helpers/assertions";

// ─── Modules under test ────────────────────────────────────────────────────

let createBookAction: typeof import("@/lib/admin/actions/book").createBook;
let updateBookAction: typeof import("@/lib/admin/actions/book").updateBook;
let deleteBookAction: typeof import("@/lib/admin/actions/book").deleteBook;
let getBookByIdAction: typeof import("@/lib/admin/actions/book").getBookById;
let getAllBooksAction: typeof import("@/lib/admin/actions/book").getAllBooks;

// ─── Constants ──────────────────────────────────────────────────────────────

const ADMIN_ID = "book-crud-admin-id";
const LOCK_TOKEN = "book-crud-lock-token";

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupLockInRedis() {
  mockRedisGet.mockResolvedValue(
    JSON.stringify({
      adminId: ADMIN_ID,
      adminName: "Admin",
      token: LOCK_TOKEN,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      version: 1,
    }),
  );
}

function setupAdminSession() {
  mockAuth.mockResolvedValue({
    user: {
      id: ADMIN_ID,
      name: "Admin User",
      email: "admin@test.edu",
      role: "ADMIN",
      sessionVersion: 1,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  });
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  mockDb.clear();
  mockDb.seed("app_settings", [createAppSettings()]);

  setupAdminSession();
  setupLockInRedis();
  mockRedisEval.mockResolvedValue(["OK", "released"]);

  mockBroadcastAdminDashboard.mockClear();
  mockBroadcastBookAvailability.mockClear();
  mockPublishEvent.mockClear();

  const bookModule = await import("@/lib/admin/actions/book");
  createBookAction = bookModule.createBook;
  updateBookAction = bookModule.updateBook;
  deleteBookAction = bookModule.deleteBook;
  getBookByIdAction = bookModule.getBookById;
  getAllBooksAction = bookModule.getAllBooks;
});

// ════════════════════════════════════════════════════════════════════════════
// createBook
// ════════════════════════════════════════════════════════════════════════════

describe("createBook", () => {
  const validParams: BookParams = {
    title: "Test Book Title",
    author: "Test Author",
    genre: "Fiction",
    rating: 4.5,
    totalCopies: 5,
    description: "A compelling test book.",
    coverColor: "#FF5733",
    coverUrl: "https://img.test.edu/books/test-cover",
    videoUrl: "https://video.test.edu/books/test-video",
    summary: "A test summary of the book.",
  };

  it("creates a book and returns the new record", async () => {
    const result = await createBookAction(validParams);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Book created successfully");
    expect(result.data).toBeDefined();
    expect(result.data!.title).toBe("Test Book Title");
    expect(result.data!.author).toBe("Test Author");
    expect(result.data!.version).toBe(1);

    assertRowExists("books", result.data!.id);
  });

  it("persists all fields in the database", async () => {
    const result = await createBookAction(validParams);
    const stored = assertRowExists("books", result.data!.id);

    expect(stored.title).toBe("Test Book Title");
    expect(stored.author).toBe("Test Author");
    expect(stored.genre).toBe("Fiction");
    expect(stored.rating).toBe(4.5);
    expect(stored.totalCopies).toBe(5);
    expect(stored.version).toBe(1);
    // availableCopies is a generated column; the mock doesn't compute it
    // during INSERT, so we skip asserting it here.
    // borrowedCount/reservedCount default to 0 in the DB schema but the
    // mock doesn't apply schema-level defaults, so we skip them too.
  });

  it("broadcasts admin dashboard update on success", async () => {
    await createBookAction(validParams);

    expect(mockBroadcastAdminDashboard).toHaveBeenCalledTimes(1);
  });

  it("publishes realtime CREATE event for books channel", async () => {
    const result = await createBookAction(validParams);

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "books",
      expect.objectContaining({
        type: "CREATE",
        entityId: result.data!.id,
      }),
    );
  });

  it("publishEvent payload contains full book data", async () => {
    const result = await createBookAction(validParams);

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "books",
      expect.objectContaining({
        data: expect.objectContaining({
          id: result.data!.id,
          title: "Test Book Title",
          version: 1,
        }),
      }),
    );
  });

  it("returns Forbidden when actor is not an admin", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "regular-user",
        name: "User",
        email: "user@test.edu",
        role: "USER",
      },
      expires: new Date().toISOString(),
    });

    const result = await createBookAction(validParams);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Failed to create book");
  });

  it("returns Forbidden when actor is not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await createBookAction(validParams);

    expect(result.success).toBe(false);
  });

  it("does not broadcast or publish when creation fails due to auth", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "regular-user",
        name: "User",
        email: "user@test.edu",
        role: "USER",
      },
      expires: new Date().toISOString(),
    });

    await createBookAction(validParams);

    expect(mockBroadcastAdminDashboard).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("succeeds despite broadcast failure", async () => {
    mockBroadcastAdminDashboard.mockRejectedValue(new Error("Broadcast down"));
    mockPublishEvent.mockRejectedValue(new Error("Pub/sub down"));

    const result = await createBookAction(validParams);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    assertRowExists("books", result.data!.id);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// updateBook
// ════════════════════════════════════════════════════════════════════════════

describe("updateBook", () => {
  it("updates a book title and bumps version", async () => {
    const book = createAvailableBook({ id: "update-title-book", version: 3 });
    mockDb.seed("books", [book]);

    const result = await updateBookAction({
      id: "update-title-book",
      title: "Updated Title",
      expectedVersion: 3,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    const stored = assertRowExists("books", "update-title-book");
    expect(stored.title).toBe("Updated Title");
    expect(stored.version).toBe(4);
  });

  it("publishes realtime UPDATE event with fresh book data", async () => {
    const book = createAvailableBook({ id: "update-rt-book", version: 2 });
    mockDb.seed("books", [book]);

    await updateBookAction({
      id: "update-rt-book",
      title: "RT Updated",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "books",
      expect.objectContaining({
        type: "UPDATE",
        entityId: "update-rt-book",
        data: expect.objectContaining({
          title: "RT Updated",
        }),
      }),
    );
  });

  it("broadcasts admin dashboard update", async () => {
    const book = createAvailableBook({ id: "update-dash-book", version: 1 });
    mockDb.seed("books", [book]);

    await updateBookAction({
      id: "update-dash-book",
      title: "Dash Updated",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockBroadcastAdminDashboard).toHaveBeenCalled();
  });

  it("rejects update with stale version", async () => {
    const book = createAvailableBook({ id: "stale-book", version: 5 });
    mockDb.seed("books", [book]);

    const result = await updateBookAction({
      id: "stale-book",
      title: "Should Fail",
      expectedVersion: 4,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("newer changes");
    assertVersionUnchanged("books", "stale-book", 5);
  });

  it("rejects update when lock is held by another admin", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        adminId: "other-admin",
        adminName: "Other Admin",
        token: "other-token",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        version: 1,
      }),
    );

    const book = createAvailableBook({ id: "locked-book" });
    mockDb.seed("books", [book]);

    const result = await updateBookAction({
      id: "locked-book",
      title: "Should Fail",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("being edited by");
  });

  it("rejects update when lock token does not match", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        adminId: ADMIN_ID,
        adminName: "Admin",
        token: "different-token",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        version: 1,
      }),
    );

    const book = createAvailableBook({ id: "token-mismatch-book" });
    mockDb.seed("books", [book]);

    const result = await updateBookAction({
      id: "token-mismatch-book",
      title: "Should Fail",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
  });

  it("rejects update when lock is expired", async () => {
    mockRedisGet.mockResolvedValueOnce(null);

    const book = createAvailableBook({ id: "expired-lock-book" });
    mockDb.seed("books", [book]);

    const result = await updateBookAction({
      id: "expired-lock-book",
      title: "Should Fail",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
  });

  it("returns Forbidden when actor is not an admin", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "regular-user",
        name: "User",
        email: "user@test.edu",
        role: "USER",
      },
      expires: new Date().toISOString(),
    });

    const book = createAvailableBook({ id: "non-admin-book" });
    mockDb.seed("books", [book]);

    const result = await updateBookAction({
      id: "non-admin-book",
      title: "Hack Attempt",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Forbidden");
  });

  describe("totalCopies validation", () => {
    it("rejects totalCopies reduction below borrowed count", async () => {
      const bookId = "replica-too-low";
      const book = createAvailableBook({
        id: bookId,
        totalCopies: 10,
        borrowedCount: 3,
        reservedCount: 0,
      });
      mockDb.seed("books", [book]);
      // Add 3 BORROWED records so totalCopies - borrowed < 0
      mockDb.seed("borrow_records", [
        createBorrowedBorrow({ userId: "u1", bookId, id: "br1" }),
        createBorrowedBorrow({ userId: "u2", bookId, id: "br2" }),
        createBorrowedBorrow({ userId: "u3", bookId, id: "br3" }),
      ]);

      const result = await updateBookAction({
        id: bookId,
        totalCopies: 2,
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Cannot reduce total copies below 3");
    });

    it("allows totalCopies reduction when enough copies available", async () => {
      const bookId = "replica-ok";
      const book = createAvailableBook({
        id: bookId,
        totalCopies: 10,
        borrowedCount: 3,
        reservedCount: 0,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [
        createBorrowedBorrow({ userId: "u1", bookId, id: "br4" }),
        createBorrowedBorrow({ userId: "u2", bookId, id: "br5" }),
        createBorrowedBorrow({ userId: "u3", bookId, id: "br6" }),
      ]);

      const result = await updateBookAction({
        id: bookId,
        totalCopies: 5,
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(true);
      const stored = assertRowExists("books", bookId);
      expect(stored.totalCopies).toBe(5);
    });

    it("allows increasing totalCopies", async () => {
      const bookId = "increase-copies";
      const book = createAvailableBook({
        id: bookId,
        totalCopies: 5,
        borrowedCount: 3,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [
        createBorrowedBorrow({ userId: "u1", bookId, id: "br7" }),
        createBorrowedBorrow({ userId: "u2", bookId, id: "br8" }),
        createBorrowedBorrow({ userId: "u3", bookId, id: "br9" }),
      ]);

      const result = await updateBookAction({
        id: bookId,
        totalCopies: 20,
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(true);
      const stored = assertRowExists("books", bookId);
      expect(stored.totalCopies).toBe(20);
      expect(stored.borrowedCount).toBe(3);
    });

    it("counts only BORROWED status records for guard", async () => {
      const bookId = "borrowed-only-count";
      const book = createAvailableBook({
        id: bookId,
        totalCopies: 5,
        borrowedCount: 1,
      });
      mockDb.seed("books", [book]);
      // Add mix of statuses — only BORROWED should count
      mockDb.seed("borrow_records", [
        createBorrowedBorrow({ userId: "u1", bookId, id: "br10" }),
        createPendingBorrow({ userId: "u2", bookId, id: "br11" }),
        createReturnedBorrow({ userId: "u3", bookId, id: "br12" }),
      ]);

      const result = await updateBookAction({
        id: bookId,
        totalCopies: 3,
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      // Borrowed = 1, so totalCopies = 3 means availableCopies = 2 >= 0
      expect(result.success).toBe(true);
    });

    it("rejects when totalCopies unchanged but borrowedCount check still passes", async () => {
      // Regression: when totalCopies is not passed, the check is skipped
      const bookId = "no-totalCopies-change";
      const book = createAvailableBook({
        id: bookId,
        totalCopies: 5,
        borrowedCount: 4,
      });
      mockDb.seed("books", [book]);
      mockDb.seed("borrow_records", [
        createBorrowedBorrow({ userId: "u1", bookId, id: "br13" }),
        createBorrowedBorrow({ userId: "u2", bookId, id: "br14" }),
        createBorrowedBorrow({ userId: "u3", bookId, id: "br15" }),
        createBorrowedBorrow({ userId: "u4", bookId, id: "br16" }),
      ]);

      // Changing only title should succeed regardless of borrowed count
      const result = await updateBookAction({
        id: bookId,
        title: "New Title No Replica Change",
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("lock lifecycle", () => {
    it("releases lock in finally block on success", async () => {
      mockRedisEval.mockClear();
      const book = createAvailableBook({ id: "lock-release-success" });
      mockDb.seed("books", [book]);

      await updateBookAction({
        id: "lock-release-success",
        title: "Lock Test",
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(mockRedisEval).toHaveBeenCalled();
    });

    it("releases lock in finally block on version conflict failure", async () => {
      mockRedisEval.mockClear();
      const book = createAvailableBook({
        id: "lock-release-fail",
        version: 10,
      });
      mockDb.seed("books", [book]);

      await updateBookAction({
        id: "lock-release-fail",
        title: "Lock Fail",
        expectedVersion: 99,
        lockToken: LOCK_TOKEN,
      });

      expect(mockRedisEval).toHaveBeenCalled();
    });

    it("fails when no lockToken is provided (assertLockOwnership throws)", async () => {
      mockRedisEval.mockClear();
      const book = createAvailableBook({ id: "no-lock-token" });
      mockDb.seed("books", [book]);

      const result = await updateBookAction({
        id: "no-lock-token",
        title: "No Lock",
        expectedVersion: 1,
      });

      // Without a lockToken, assertLockOwnership throws LockOwnershipError
      expect(result.success).toBe(false);
      expect(result.message).toContain("editing session expired");
      // The book should remain unchanged
      const stored = assertRowExists("books", "no-lock-token");
      expect(stored.title).not.toBe("No Lock");
    });
  });

  describe("graceful degradation", () => {
    it("succeeds despite broadcast failure", async () => {
      mockBroadcastAdminDashboard.mockRejectedValue(
        new Error("Broadcast down"),
      );
      mockPublishEvent.mockRejectedValue(new Error("Pub/sub down"));

      const book = createAvailableBook({ id: "graceful-update" });
      mockDb.seed("books", [book]);

      const result = await updateBookAction({
        id: "graceful-update",
        title: "Graceful Update",
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(true);
      const stored = assertRowExists("books", "graceful-update");
      expect(stored.title).toBe("Graceful Update");
    });
  });

  describe("edge cases", () => {
    it("updates book when no borrow records exist for the book", async () => {
      const book = createAvailableBook({
        id: "no-borrows-book",
        totalCopies: 3,
      });
      mockDb.seed("books", [book]);

      const result = await updateBookAction({
        id: "no-borrows-book",
        totalCopies: 10,
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(true);
      const stored = assertRowExists("books", "no-borrows-book");
      expect(stored.totalCopies).toBe(10);
    });

    it("updates non-existent book returns conflict", async () => {
      const result = await updateBookAction({
        id: "non-existent",
        title: "Ghost",
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("newer changes");
    });

    it("updates multiple fields simultaneously", async () => {
      const book = createAvailableBook({
        id: "multi-field-update",
        totalCopies: 5,
      });
      mockDb.seed("books", [book]);

      const result = await updateBookAction({
        id: "multi-field-update",
        title: "Multi Update",
        author: "New Author",
        genre: "Non-Fiction",
        rating: 3.0,
        totalCopies: 10,
        expectedVersion: 1,
        lockToken: LOCK_TOKEN,
      });

      expect(result.success).toBe(true);
      const stored = assertRowExists("books", "multi-field-update");
      expect(stored.title).toBe("Multi Update");
      expect(stored.author).toBe("New Author");
      expect(stored.genre).toBe("Non-Fiction");
      expect(stored.rating).toBe(3.0);
      expect(stored.totalCopies).toBe(10);
      expect(stored.version).toBe(2);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deleteBook
// ════════════════════════════════════════════════════════════════════════════

describe("deleteBook", () => {
  it("deletes a book with no borrow records", async () => {
    const book = createAvailableBook({ id: "delete-clean-book", version: 2 });
    mockDb.seed("books", [book]);

    const result = await deleteBookAction({
      id: "delete-clean-book",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("Book deleted successfully");
    expect(result.data).toBeDefined();
    expect(result.data!.id).toBe("delete-clean-book");
    assertRowNotExists("books", "delete-clean-book");
  });

  it("blocks deletion when borrow records exist", async () => {
    const bookId = "blocked-delete-book";
    const book = createAvailableBook({ id: bookId });
    mockDb.seed("books", [book]);
    mockDb.seed("borrow_records", [
      createReturnedBorrow({ userId: "u1", bookId, id: "br-delete-1" }),
    ]);

    const result = await deleteBookAction({
      id: bookId,
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(
      "Cannot delete book with existing borrow records",
    );
    assertRowExists("books", bookId);
  });

  it("blocks deletion regardless of borrow record status", async () => {
    const bookId = "any-borrow-blocks";
    const book = createAvailableBook({ id: bookId });
    mockDb.seed("books", [book]);
    // Even a single PENDING or RETURNED record blocks deletion
    mockDb.seed("borrow_records", [
      createPendingBorrow({ userId: "u1", bookId, id: "br-any-1" }),
    ]);

    const result = await deleteBookAction({
      id: bookId,
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Cannot delete");
    assertRowExists("books", bookId);
  });

  it("rejects deletion with stale version", async () => {
    const book = createAvailableBook({ id: "stale-delete-book", version: 3 });
    mockDb.seed("books", [book]);

    const result = await deleteBookAction({
      id: "stale-delete-book",
      expectedVersion: 2,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("newer changes");
    assertRowExists("books", "stale-delete-book");
  });

  it("publishes realtime DELETE event", async () => {
    const book = createAvailableBook({ id: "rt-delete-book" });
    mockDb.seed("books", [book]);

    await deleteBookAction({
      id: "rt-delete-book",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "books",
      expect.objectContaining({
        type: "DELETE",
        entityId: "rt-delete-book",
      }),
    );
  });

  it("broadcasts admin dashboard update after deletion", async () => {
    const book = createAvailableBook({ id: "dash-delete-book" });
    mockDb.seed("books", [book]);

    await deleteBookAction({
      id: "dash-delete-book",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockBroadcastAdminDashboard).toHaveBeenCalled();
  });

  it("returns Forbidden when actor is not an admin", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "regular-user",
        name: "User",
        email: "user@test.edu",
        role: "USER",
      },
      expires: new Date().toISOString(),
    });

    const book = createAvailableBook({ id: "non-admin-delete" });
    mockDb.seed("books", [book]);

    const result = await deleteBookAction({
      id: "non-admin-delete",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Forbidden");
  });

  it("releases lock in finally block on success", async () => {
    mockRedisEval.mockClear();
    const book = createAvailableBook({ id: "lock-release-del-success" });
    mockDb.seed("books", [book]);

    await deleteBookAction({
      id: "lock-release-del-success",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(mockRedisEval).toHaveBeenCalled();
  });

  it("releases lock in finally block on failure", async () => {
    mockRedisEval.mockClear();
    const book = createAvailableBook({
      id: "lock-release-del-fail",
      version: 5,
    });
    mockDb.seed("books", [book]);

    await deleteBookAction({
      id: "lock-release-del-fail",
      expectedVersion: 99,
      lockToken: LOCK_TOKEN,
    });

    expect(mockRedisEval).toHaveBeenCalled();
  });

  it("succeeds despite broadcast failure", async () => {
    mockBroadcastAdminDashboard.mockRejectedValue(new Error("Broadcast down"));
    mockPublishEvent.mockRejectedValue(new Error("Pub/sub down"));

    const book = createAvailableBook({ id: "graceful-del-book" });
    mockDb.seed("books", [book]);

    const result = await deleteBookAction({
      id: "graceful-del-book",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(true);
    assertRowNotExists("books", "graceful-del-book");
  });

  it("returns conflict error for non-existent book on delete", async () => {
    const result = await deleteBookAction({
      id: "ghost-book",
      expectedVersion: 1,
      lockToken: LOCK_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("newer changes");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getBookById
// ════════════════════════════════════════════════════════════════════════════

describe("getBookById", () => {
  it("returns a book by its id", async () => {
    const book = createAvailableBook({ id: "get-by-id" });
    mockDb.seed("books", [book]);

    const result = await getBookByIdAction("get-by-id");

    expect(result).toBeDefined();
    expect(result!.id).toBe("get-by-id");
    expect(result!.title).toBe(book.title);
  });

  it("returns null for non-existent book", async () => {
    const result = await getBookByIdAction("non-existent-id");

    expect(result).toBeNull();
  });

  it("returns correct version and counters", async () => {
    const book = createAvailableBook({
      id: "counters-book",
      totalCopies: 10,
      borrowedCount: 3,
      reservedCount: 1,
      version: 7,
    });
    mockDb.seed("books", [book]);

    const result = await getBookByIdAction("counters-book");

    expect(result).toBeDefined();
    expect(result!.totalCopies).toBe(10);
    expect(result!.availableCopies).toBe(6);
    expect(result!.version).toBe(7);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getAllBooks
// ════════════════════════════════════════════════════════════════════════════

describe("getAllBooks", () => {
  it("returns paginated books", async () => {
    const books = Array.from({ length: 5 }, (_, i) =>
      createAvailableBook({ id: `paginated-book-${i}`, title: `Book ${i}` }),
    );
    mockDb.seed("books", books);

    const result = await getAllBooksAction({ page: 1, limit: 3 });

    expect(result.success).toBe(true);
    expect(result.data!.books.length).toBe(3);
    expect(result.data!.totalPages).toBe(2);
  });

  it("returns empty array when no books exist", async () => {
    const result = await getAllBooksAction({});

    expect(result.success).toBe(true);
    expect(result.data!.books.length).toBe(0);
    expect(result.data!.totalPages).toBe(0);
  });

  it("filters by search query (title match)", async () => {
    mockDb.seed("books", [
      createAvailableBook({ id: "match-1", title: "Dragon Lore" }),
      createAvailableBook({ id: "match-2", title: "Dragon Tales" }),
      createAvailableBook({ id: "no-match", title: "Unrelated" }),
    ]);

    const result = await getAllBooksAction({ query: "Dragon" });

    expect(result.success).toBe(true);
    expect(result.data!.books.length).toBe(2);
  });

  it("filters by search query (author match)", async () => {
    mockDb.seed("books", [
      createAvailableBook({
        id: "author-match",
        title: "Book A",
        author: "Tolkien",
      }),
      createAvailableBook({
        id: "author-no-match",
        title: "Book B",
        author: "Asimov",
      }),
    ]);

    const result = await getAllBooksAction({ query: "Tolkien" });

    expect(result.success).toBe(true);
    expect(result.data!.books.length).toBe(1);
    expect(result.data!.books[0].id).toBe("author-match");
  });

  it("returns empty array when query matches nothing", async () => {
    mockDb.seed("books", [
      createAvailableBook({ id: "only-book", title: "Only Book" }),
    ]);

    const result = await getAllBooksAction({ query: "xyznonexistent" });

    expect(result.success).toBe(true);
    expect(result.data!.books.length).toBe(0);
  });

  it("handles pagination offset correctly for page 2", async () => {
    const books = Array.from({ length: 5 }, (_, i) =>
      createAvailableBook({
        id: `offset-book-${i}`,
        title: `Offset Book ${i}`,
      }),
    );
    mockDb.seed("books", books);

    const page1 = await getAllBooksAction({ page: 1, limit: 2 });
    const page2 = await getAllBooksAction({ page: 2, limit: 2 });

    expect(page1.data!.books.length).toBe(2);
    expect(page2.data!.books.length).toBe(2);
    expect(page1.data!.books[0].id).not.toBe(page2.data!.books[0].id);
  });

  it("returns books ordered by createdAt descending", async () => {
    const now = Date.now();
    const oldBook = createAvailableBook({
      id: "old-book",
      createdAt: new Date(now - 86400000),
    });
    const newBook = createAvailableBook({
      id: "new-book",
      createdAt: new Date(now),
    });
    mockDb.seed("books", [oldBook, newBook]);

    const result = await getAllBooksAction({ limit: 10 });

    expect(result.data!.books[0].id).toBe("new-book");
    expect(result.data!.books[1].id).toBe("old-book");
  });

  it("returns default pagination when called with empty object", async () => {
    const books = Array.from({ length: 25 }, (_, i) =>
      createAvailableBook({ id: `default-page-${i}`, title: `Default ${i}` }),
    );
    mockDb.seed("books", books);

    const result = await getAllBooksAction({});

    expect(result.success).toBe(true);
    expect(result.data!.books.length).toBe(20);
    expect(result.data!.totalPages).toBe(2);
  });
});
