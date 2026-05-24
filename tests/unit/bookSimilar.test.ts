import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/database/drizzle", () => ({ db: {} }));
vi.mock("@/database/schema", () => ({ books: {}, borrowRecords: {}, users: {} }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock(
  "@/lib/admin/realtime/broadcast/dashboardSocketServer",
  () => ({
    broadcastAdminDashboardUpdate: vi.fn(),
    broadcastBookAvailabilityUpdate: vi.fn(),
  }),
);
vi.mock(
  "@/lib/admin/realtime/concurrency/rowConcurrency",
  () => ({ publishEvent: vi.fn(), CONFLICT_ERROR_MESSAGE: "Conflict" }),
);

const mockGetSimilarBooksCached = vi.fn();
vi.mock("@/lib/performance/cache", () => ({
  getSimilarBooksCached: mockGetSimilarBooksCached,
  CACHE_TAGS: { books: "books", users: "users" },
}));

const { getSimilarBooks } = await import("@/lib/actions/book");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSimilarBooks", () => {
  const bookId = "book-1";

  describe("success paths", () => {
    it("returns similar books when cache returns results", async () => {
      const mockBooks = [
        { id: "b2", title: "Similar Book 1", genre: "Fiction" },
        { id: "b3", title: "Similar Book 2", genre: "Fiction" },
      ];
      mockGetSimilarBooksCached.mockResolvedValue(mockBooks);

      const result = await getSimilarBooks(bookId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockBooks);
      expect(mockGetSimilarBooksCached).toHaveBeenCalledWith(bookId);
    });

    it("returns empty array when no similar books exist", async () => {
      mockGetSimilarBooksCached.mockResolvedValue([]);

      const result = await getSimilarBooks(bookId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe("JSON serialization behavior", () => {
    it("drops undefined fields during JSON.parse(JSON.stringify(...))", async () => {
      const bookWithUndefined = {
        id: "b2",
        title: "Book",
        optionalField: undefined,
      };
      mockGetSimilarBooksCached.mockResolvedValue([bookWithUndefined]);

      const result = await getSimilarBooks(bookId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect("optionalField" in result.data[0]).toBe(false);
      }
    });
  });

  describe("failure paths", () => {
    it("returns error when cache throws an Error", async () => {
      mockGetSimilarBooksCached.mockRejectedValue(
        new Error("Cache failure"),
      );

      const result = await getSimilarBooks(bookId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to fetch similar books");
    });

    it("returns error when cache throws non-Error", async () => {
      mockGetSimilarBooksCached.mockRejectedValue("string error");

      const result = await getSimilarBooks(bookId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to fetch similar books");
    });
  });
});
