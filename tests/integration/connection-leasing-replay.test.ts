/**
 * connection-leasing-replay.test.ts — SSE connection lease + replay buffer tests.
 *
 * Tests two distinct subsystems from rateLimit.ts and dashboardRedisPubSub.ts:
 *
 * 1. Connection Leasing (acquireSseConnectionLease / refreshSseConnectionLease
 *    / releaseSseConnectionLease):
 *    - Lease acquisition with user and IP identities
 *    - Connection limit enforcement (authenticated=3, anonymous=2)
 *    - Lease refresh (keepalive extension)
 *    - Lease release (cleanup on disconnect)
 *    - Expired lease cleanup via ZREMRANGEBYSCORE
 *    - Graceful degradation on Redis failure
 *
 * 2. Replay Buffer (getBorrowBookRealtimeReplay / publishBookAvailabilityUpdate):
 *    - Replay ordering by event ID
 *    - Last-Event-ID filtering
 *    - Buffer content integrity
 *    - Empty replay handling
 *    - Corrupt replay entries filtered
 *    - publishBookAvailabilityUpdate Lua script pattern
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import {
  mockRedisEval,
  mockRedisGet,
  mockRedisSet,
  mockRedisPublish,
  mockRedisDel,
  mockRedisMget,
} from "./helpers/instances";
import redis from "@/database/redis";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Connection Leasing
// ═══════════════════════════════════════════════════════════════════════════

describe("SSE Connection Leasing", () => {
  let acquireSseConnectionLease: typeof import("@/lib/essentials/rateLimit").acquireSseConnectionLease;
  let releaseSseConnectionLease: typeof import("@/lib/essentials/rateLimit").releaseSseConnectionLease;
  let refreshSseConnectionLease: typeof import("@/lib/essentials/rateLimit").refreshSseConnectionLease;
  let getRateLimitIdentity: typeof import("@/lib/essentials/rateLimit").getRateLimitIdentity;
  let createRateLimitHeaders: typeof import("@/lib/essentials/rateLimit").createRateLimitHeaders;

  beforeEach(() => {
    mockRedisEval.mockReset();
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockRedisDel.mockReset();
    mockRedisPublish.mockReset();
    mockRedisMget.mockReset();

    // Default: Redis accepts the lease
    mockRedisEval.mockResolvedValue([1, 1] as [number, number]);
  });

  beforeAll(async () => {
    const mod = await import("@/lib/essentials/rateLimit");
    acquireSseConnectionLease = mod.acquireSseConnectionLease;
    releaseSseConnectionLease = mod.releaseSseConnectionLease;
    refreshSseConnectionLease = mod.refreshSseConnectionLease;
    getRateLimitIdentity = mod.getRateLimitIdentity;
    createRateLimitHeaders = mod.createRateLimitHeaders;
  });

  describe("acquireSseConnectionLease", () => {
    it("acquires a lease for authenticated user identity", async () => {
      const identity = { key: "user:user-1", kind: "user" as const, value: "user-1" };
      mockRedisEval.mockResolvedValue([1, 1] as [number, number]);

      const lease = await acquireSseConnectionLease(identity);

      expect(lease.success).toBe(true);
      expect(lease.leaseId).toBeTruthy();
      expect(lease.limit).toBe(3); // AUTHENTICATED_SSE_CONNECTION_LIMIT
      expect(lease.current).toBe(1);

      // Lua script: ZREMRANGEBYSCORE, ZCARD, conditional ZADD+PEXPIRE
      expect(mockRedisEval).toHaveBeenCalledWith(
        expect.any(String),
        [expect.stringContaining("sse:book-stream:connections:user:user-1")],
        expect.arrayContaining([
          expect.any(Number), // now
          expect.any(Number), // TTL
          3,                  // limit (number, not string)
          expect.any(String), // leaseId
        ]),
      );
    });

    it("acquires a lease for anonymous IP identity", async () => {
      const identity = { key: "ip:203.0.113.42", kind: "ip" as const, value: "203.0.113.42" };
      mockRedisEval.mockResolvedValue([1, 1] as [number, number]);

      const lease = await acquireSseConnectionLease(identity);

      expect(lease.success).toBe(true);
      expect(lease.limit).toBe(2); // ANONYMOUS_SSE_CONNECTION_LIMIT
    });

    it("rejects lease when connection limit is reached", async () => {
      // Limit = 2 for anonymous, current = 2 → denied
      mockRedisEval.mockResolvedValue([0, 2] as [number, number]);

      const identity = { key: "ip:203.0.113.42", kind: "ip" as const, value: "203.0.113.42" };
      const lease = await acquireSseConnectionLease(identity);

      expect(lease.success).toBe(false);
      expect(lease.leaseId).toBeNull();
      expect(lease.current).toBe(2);
    });

    it("distinguishes user limit (3) from anonymous limit (2)", async () => {
      const userIdentity = { key: "user:u1", kind: "user" as const, value: "u1" };
      const ipIdentity = { key: "ip:1.2.3.4", kind: "ip" as const, value: "1.2.3.4" };

      // Both succeed with current=1
      mockRedisEval.mockResolvedValue([1, 1] as [number, number]);

      const userLease = await acquireSseConnectionLease(userIdentity);
      const ipLease = await acquireSseConnectionLease(ipIdentity);

      expect(userLease.limit).toBe(3);
      expect(ipLease.limit).toBe(2);
    });

    it("gracefully degrades and allows lease on Redis failure", async () => {
      mockRedisEval.mockRejectedValue(new Error("Redis connection timeout"));

      const identity = { key: "ip:1.2.3.4", kind: "ip" as const, value: "1.2.3.4" };
      const lease = await acquireSseConnectionLease(identity);

      // Falls back to granting the lease
      expect(lease.success).toBe(true);
      expect(lease.leaseId).toBeTruthy();
      expect(lease.limit).toBe(2);
    });
  });

  describe("releaseSseConnectionLease", () => {
    it("removes the lease from the sorted set", async () => {
      const zremMock = vi.fn().mockResolvedValue(1);
      (redis as unknown as Record<string, unknown>).zrem = zremMock;

      const key = "sse:book-stream:connections:user:u1";
      const leaseId = "test-lease-id";

      await releaseSseConnectionLease(key, leaseId);

      expect(zremMock).toHaveBeenCalledWith(key, leaseId);
    });

    it("handles release failure gracefully", async () => {
      (redis as unknown as Record<string, unknown>).zrem = vi.fn().mockRejectedValue(new Error("Redis unreachable"));

      const key = "sse:book-stream:connections:user:u1";
      const leaseId = "test-lease-id";

      await expect(
        releaseSseConnectionLease(key, leaseId),
      ).resolves.not.toThrow();
    });
  });

  describe("refreshSseConnectionLease", () => {
    it("extends TTL on keepalive", async () => {
      const zaddMock = vi.fn().mockResolvedValue(1);
      const pexpireMock = vi.fn().mockResolvedValue(1);
      (redis as unknown as Record<string, unknown>).zadd = zaddMock;
      (redis as unknown as Record<string, unknown>).pexpire = pexpireMock;

      const key = "sse:book-stream:connections:user:u1";
      const leaseId = "test-lease-id";

      await refreshSseConnectionLease(key, leaseId);

      expect(zaddMock).toHaveBeenCalled();
      expect(pexpireMock).toHaveBeenCalledWith(key, 90000);
    });

    it("handles refresh failure gracefully", async () => {
      (redis as unknown as Record<string, unknown>).zadd = vi.fn().mockRejectedValue(new Error("Redis timeout"));
      (redis as unknown as Record<string, unknown>).pexpire = vi.fn().mockRejectedValue(new Error("Redis timeout"));

      const key = "sse:book-stream:connections:user:u1";
      const leaseId = "test-lease-id";

      await expect(
        refreshSseConnectionLease(key, leaseId),
      ).resolves.not.toThrow();
    });
  });

  describe("getRateLimitIdentity", () => {
    it("returns user identity when userId is present", () => {
      const request = new Request("http://localhost/test");
      const identity = getRateLimitIdentity(request, "user-42");

      expect(identity.kind).toBe("user");
      expect(identity.key).toBe("user:user-42");
      expect(identity.value).toBe("user-42");
    });

    it("returns IP identity when no userId", () => {
      const request = new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "203.0.113.99" },
      });
      const identity = getRateLimitIdentity(request, null);

      expect(identity.kind).toBe("ip");
      expect(identity.key).toBe("ip:203.0.113.99");
    });

    it("falls back to x-real-ip when no x-forwarded-for", () => {
      const request = new Request("http://localhost/test", {
        headers: { "x-real-ip": "10.0.0.1" },
      });
      const identity = getRateLimitIdentity(request, null);

      expect(identity.key).toBe("ip:10.0.0.1");
    });
  });

  describe("createRateLimitHeaders", () => {
    it("generates correct rate limit headers", () => {
      const reset = Date.now() + 60_000;
      const result = {
        success: true,
        limit: 30,
        remaining: 28,
        reset,
        pending: Promise.resolve(),
      };

      const headers = createRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("30");
      expect(headers["X-RateLimit-Remaining"]).toBe("28");
      expect(headers["Retry-After"]).toBe(String(Math.ceil((reset - Date.now()) / 1000)));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Replay Buffer
// ═══════════════════════════════════════════════════════════════════════════

describe("Borrow Book Replay Buffer", () => {
  let getBorrowBookRealtimeReplay: typeof import("@/lib/admin/realtime/broadcast/dashboardRedisPubSub").getBorrowBookRealtimeReplay;
  let publishBookAvailabilityUpdate: typeof import("@/lib/admin/realtime/broadcast/dashboardRedisPubSub").publishBookAvailabilityUpdate;

  let mockRedisLrange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRedisEval.mockReset();
    mockRedisPublish.mockReset();
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockRedisMget.mockReset();
    mockRedisDel.mockReset();

    mockRedisLrange = vi.fn().mockResolvedValue([]);
    (redis as unknown as Record<string, unknown>).lrange = mockRedisLrange;
    (redis as unknown as Record<string, unknown>).subscribe = vi
      .fn()
      .mockReturnValue({
        on: vi.fn(),
        off: vi.fn(),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      });
  });

  beforeAll(async () => {
    const mod = await import("@/lib/admin/realtime/broadcast/dashboardRedisPubSub");
    getBorrowBookRealtimeReplay = mod.getBorrowBookRealtimeReplay;
    publishBookAvailabilityUpdate = mod.publishBookAvailabilityUpdate;
  });

  describe("getBorrowBookRealtimeReplay", () => {
    it("returns all replay events when no lastEventId", async () => {
      const events = [
        { id: 1, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 5, reservedCount: 0, borrowedCount: 0, version: 1 }, publishedAt: "" },
        { id: 2, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 4, reservedCount: 1, borrowedCount: 0, version: 2 }, publishedAt: "" },
      ];
      mockRedisLrange.mockResolvedValue(events.map((e) => JSON.stringify(e)));

      const result = await getBorrowBookRealtimeReplay();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it("filters events with ID greater than lastEventId", async () => {
      const events = [
        { id: 5, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 5, reservedCount: 0, borrowedCount: 0, version: 1 }, publishedAt: "" },
        { id: 10, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 4, reservedCount: 1, borrowedCount: 0, version: 2 }, publishedAt: "" },
        { id: 15, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 3, reservedCount: 2, borrowedCount: 0, version: 3 }, publishedAt: "" },
      ];
      mockRedisLrange.mockResolvedValue(events.map((e) => JSON.stringify(e)));

      const result = await getBorrowBookRealtimeReplay(9);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(10);
      expect(result[1].id).toBe(15);
    });

    it("returns empty array when no events after lastEventId", async () => {
      const events = [
        { id: 1, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 5, reservedCount: 0, borrowedCount: 0, version: 1 }, publishedAt: "" },
      ];
      mockRedisLrange.mockResolvedValue(events.map((e) => JSON.stringify(e)));

      const result = await getBorrowBookRealtimeReplay(100);

      expect(result).toHaveLength(0);
    });

    it("returns events sorted by ID ascending", async () => {
      const events = [
        { id: 10, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 3, reservedCount: 2, borrowedCount: 0, version: 3 }, publishedAt: "" },
        { id: 1, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 5, reservedCount: 0, borrowedCount: 0, version: 1 }, publishedAt: "" },
        { id: 5, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 4, reservedCount: 1, borrowedCount: 0, version: 2 }, publishedAt: "" },
      ];
      mockRedisLrange.mockResolvedValue(events.map((e) => JSON.stringify(e)));

      const result = await getBorrowBookRealtimeReplay();

      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(5);
      expect(result[2].id).toBe(10);
    });

    it("filters out malformed replay entries", async () => {
      mockRedisLrange.mockResolvedValue([
        JSON.stringify({ id: 1, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 5, reservedCount: 0, borrowedCount: 0, version: 1 }, publishedAt: "" }),
        "not-json",
        JSON.stringify({ id: 2, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 4, reservedCount: 1, borrowedCount: 0, version: 2 }, publishedAt: "" }),
        null,
        JSON.stringify({ id: 3 }),
      ]);

      const result = await getBorrowBookRealtimeReplay();

      // Only the two properly formed events should remain
      expect(result).toHaveLength(2);
    });

    it("returns empty array when Redis lrange fails", async () => {
      mockRedisLrange.mockRejectedValue(new Error("Redis down"));

      const result = await getBorrowBookRealtimeReplay();

      expect(result).toEqual([]);
    });

    it("queries the correct Redis key", async () => {
      mockRedisLrange.mockResolvedValue([]);

      await getBorrowBookRealtimeReplay();

      expect(mockRedisLrange).toHaveBeenCalledWith(
        "book:borrow:realtime:recent",
        0,
        -1,
      );
    });
  });

  describe("publishBookAvailabilityUpdate", () => {
    it("calls redis.eval with the publish-and-replay script", async () => {
      mockRedisEval.mockResolvedValue(
        JSON.stringify({
          id: 42,
          event: "BOOK_UPDATED",
          message: {
            type: "BOOK_UPDATED",
            timestamp: new Date().toISOString(),
            bookId: "book-1",
            availableCount: 5,
            reservedCount: 1,
            borrowedCount: 0,
            version: 2,
          },
          publishedAt: new Date().toISOString(),
        }),
      );

      await publishBookAvailabilityUpdate("book-1", 5, 1, 0, 2);

      // The Lua script uses KEYS: [sequence, replay, channel]
      // and ARGV: [messageJSON, eventType, publishedAt, replayLimit]
      expect(mockRedisEval).toHaveBeenCalledWith(
        expect.any(String),
        [
          "book:borrow:realtime:sequence",
          "book:borrow:realtime:recent",
          "book:borrow:realtime",
        ],
        expect.arrayContaining([
          expect.any(String),  // message JSON
          "BOOK_UPDATED",      // event type
          expect.any(String),  // publishedAt
          250,                 // replay limit
        ]),
      );
    });

    it("publishes and returns the validated event", async () => {
      const validEvent = {
        id: 1,
        event: "BOOK_UPDATED",
        message: {
          type: "BOOK_UPDATED",
          timestamp: new Date().toISOString(),
          bookId: "book-1",
          availableCount: 5,
          reservedCount: 0,
          borrowedCount: 0,
          version: 1,
        },
        publishedAt: new Date().toISOString(),
      };
      mockRedisEval.mockResolvedValue(JSON.stringify(validEvent));

      const result = await publishBookAvailabilityUpdate("book-1", 5, 0, 0, 1);

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.event).toBe("BOOK_UPDATED");
    });

    it("returns fallback event when eval returns invalid data", async () => {
      mockRedisEval.mockResolvedValue("invalid-json-or-data");

      const result = await publishBookAvailabilityUpdate("book-1", 5, 0, 0, 1);

      expect(result).toBeDefined();
      expect(result.id).toBe(0);
      expect(result.event).toBe("BOOK_UPDATED");
    });

    it("propagates error when eval fails (no try/catch around redis.eval)", async () => {
      mockRedisEval.mockRejectedValue(new Error("Redis down"));

      await expect(
        publishBookAvailabilityUpdate("book-1", 5, 0, 0, 1),
      ).rejects.toThrow("Redis down");
    });
  });
});
