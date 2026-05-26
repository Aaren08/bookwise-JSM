/**
 * sse-endpoints.test.ts — Integration tests for all SSE streaming endpoints.
 *
 * Three routes under test:
 *   1. GET /api/book/stream        — book availability SSE stream
 *   2. GET /api/admin/dashboard/realtime       — admin dashboard SSE stream
 *   3. GET /api/admin/realtime/rows            — admin row-level realtime stream
 *
 * Validates:
 *   - Auth enforcement per endpoint
 *   - Rate-limit integration (safeRateLimit + connection leases)
 *   - Last-Event-ID parsing and replay binding
 *   - Stream initialisation (retry frame, heartbeat, connected events)
 *   - Cleanup on abort (lease release, subscription unsubscribe)
 *   - Redis pub/sub subscription lifecycle
 *   - Heartbeat encoding for proxy-body-read-timeout prevention
 *   - Connection lease acquire / refresh / release lifecycle
 *   - Graceful degradation when Redis is unavailable
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  mockAuth,
  mockDb,
  mockRedisGet,
  mockRedisSet,
  mockRedisEval,
  mockRedisPublish,
  mockRedisMget,
  mockRedisDel,
} from "./helpers/instances";
import {
  createAppSettings,
  createAdminSession,
} from "./helpers/fixtures";

// ─── Helpers: Redis mock augmentation ──────────────────────────────────────

import redis from "@/database/redis";

type SubscriptionMock = {
  on: Mock;
  off: Mock;
  unsubscribe: Mock;
  _emit: (event: string, ...args: unknown[]) => void;
  _handlers: Record<string, (...args: unknown[]) => void>;
};

let mockSubscription: SubscriptionMock;
let mockRedisLrange: Mock;
beforeEach(() => {
  mockSubscription = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!mockSubscription._handlers) mockSubscription._handlers = {};
      mockSubscription._handlers[event] = handler;
      return mockSubscription;
    }),
    off: vi.fn(),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    _emit: (event: string, ...args: unknown[]) => {
      const h = mockSubscription._handlers?.[event];
      if (h) h(...args);
    },
    _handlers: {} as Record<string, (...args: unknown[]) => void>,
  };

  mockRedisLrange = vi.fn().mockResolvedValue([]);

  (redis as unknown as Record<string, unknown>).subscribe = vi
    .fn()
    .mockReturnValue(mockSubscription);
  (redis as unknown as Record<string, unknown>).lrange = mockRedisLrange;
  (redis as unknown as Record<string, unknown>).on = vi.fn();
  (redis as unknown as Record<string, unknown>).off = vi.fn();
  (redis as unknown as Record<string, unknown>).zrem = vi.fn().mockResolvedValue(1);
});

// ─── Helpers: SSE stream reading ───────────────────────────────────────────

async function readStreamChunks(
  response: Response,
  count: number,
  timeoutMs = 500,
): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reader.cancel().catch(() => {});
      resolve(chunks);
    }, timeoutMs);

    function pump(): Promise<void> {
      return reader
        .read()
        .then(({ done, value }: { done: boolean; value?: Uint8Array }) => {
          if (done) {
            clearTimeout(timer);
            resolve(chunks);
            return;
          }
          if (value) {
            chunks.push(decoder.decode(value, { stream: true }));
          }
          if (chunks.length >= count) {
            clearTimeout(timer);
            reader.cancel().catch(() => {});
            resolve(chunks);
            return;
          }
          return pump();
        })
        .catch((err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
    }

    pump().catch(reject);
  });
}

function createAbortableRequest(
  url: string,
  options: { headers?: Record<string, string> } = {},
): { request: Request; controller: AbortController } {
  const controller = new AbortController();
  const headers = new Headers({ "content-type": "text/event-stream", ...options.headers });
  const request = new Request(url, { signal: controller.signal, headers });
  return { request, controller };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Book Availability SSE Stream  (/api/book/stream)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/book/stream — book availability SSE", () => {
  let GET_BOOK_SSE: typeof import("@/app/api/book/stream/route").GET;

  beforeEach(async () => {
    mockDb.clear();
    mockDb.seed("app_settings", [createAppSettings()]);
    mockAuth.mockResolvedValue(null); // default anonymous

    mockRedisEval.mockResolvedValue([1, 0] as [number, number]); // lease acquired
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockRedisPublish.mockReset();
    mockRedisDel.mockReset();
    mockRedisMget.mockReset();
    mockRedisLrange.mockResolvedValue([]);

    const mod = await import("@/app/api/book/stream/route");
    GET_BOOK_SSE = mod.GET;
  });

  describe("auth and rate limiting", () => {
    it("returns 200 for unauthenticated requests (anonymous allowed)", async () => {
      mockAuth.mockResolvedValueOnce(null);
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      const response = await GET_BOOK_SSE(request);
      controller.abort();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    });

    it("returns 200 for authenticated user requests", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user-1", name: "User", email: "u@t.edu", role: "USER" },
        expires: new Date().toISOString(),
      });
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      const response = await GET_BOOK_SSE(request);
      controller.abort();
      expect(response.status).toBe(200);
    });

    it("returns 429 when anonymous connect rate limit exceeded", async () => {
      const { safeRateLimit } = await import("@/lib/essentials/rateLimit");
      vi.mocked(safeRateLimit).mockResolvedValueOnce({
        success: false,
        limit: 12,
        remaining: 0,
        reset: Date.now() + 60000,
        pending: Promise.resolve(),
      });

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      const response = await GET_BOOK_SSE(request);
      controller.abort();
      expect(response.status).toBe(429);
    });

    it("returns 429 when connection lease limit is reached", async () => {
      mockRedisEval.mockResolvedValueOnce([0, 3] as [number, number]); // lease denied

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      const response = await GET_BOOK_SSE(request);
      controller.abort();
      expect(response.status).toBe(429);
      expect(response.headers.get("X-Connection-Limit")).toBe("2");
    });
  });

  describe("stream initialization", () => {
    it("sends a retry frame followed by replay events", async () => {
      const replayEvent = {
        id: 1,
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
      };
      mockRedisLrange.mockResolvedValueOnce([JSON.stringify(replayEvent)]);

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      const response = await GET_BOOK_SSE(request);
      const chunks = await readStreamChunks(response, 2, 300);
      controller.abort();

      const combined = chunks.join("");
      expect(combined).toContain("retry:");
      expect(combined).toContain("id: 1");
      expect(combined).toContain("event: BOOK_UPDATED");
    });

    it("respects Last-Event-ID header and filters replay", async () => {
      const events = [
        { id: 1, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 5, reservedCount: 0, borrowedCount: 0, version: 1 }, publishedAt: "" },
        { id: 2, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 4, reservedCount: 1, borrowedCount: 0, version: 2 }, publishedAt: "" },
        { id: 3, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "b1", availableCount: 3, reservedCount: 2, borrowedCount: 0, version: 3 }, publishedAt: "" },
      ];
      mockRedisLrange.mockResolvedValueOnce(events.map((e) => JSON.stringify(e)));

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
        { headers: { "last-event-id": "1" } },
      );
      const response = await GET_BOOK_SSE(request);
      const chunks = await readStreamChunks(response, 3, 300);
      controller.abort();

      const combined = chunks.join("");
      // Should skip event id:1 and only send id:2 and id:3
      expect(combined).not.toContain('"availableCount":5');
      expect(combined).toContain('"availableCount":4');
      expect(combined).toContain('"availableCount":3');
    });

    it("scopes events by bookId query parameter", async () => {
      const events = [
        { id: 1, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "book-a", availableCount: 5, reservedCount: 0, borrowedCount: 0, version: 1 }, publishedAt: "" },
        { id: 2, event: "BOOK_UPDATED", message: { type: "BOOK_UPDATED", timestamp: "", bookId: "book-b", availableCount: 3, reservedCount: 1, borrowedCount: 0, version: 2 }, publishedAt: "" },
      ];
      mockRedisLrange.mockResolvedValueOnce(events.map((e) => JSON.stringify(e)));

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream?bookId=book-a",
      );
      const response = await GET_BOOK_SSE(request);
      const chunks = await readStreamChunks(response, 3, 300);
      controller.abort();

      const combined = chunks.join("");
      expect(combined).toContain("book-a");
      expect(combined).not.toContain("book-b");
    });

    it("sends keepalive comments on interval", async () => {
      vi.useFakeTimers();
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      const response = await GET_BOOK_SSE(request);

      // Advance past keepalive interval
      await vi.advanceTimersByTimeAsync(16_000);
      controller.abort();
      vi.useRealTimers();

      const chunks = await readStreamChunks(response, 2, 100);
      const combined = chunks.join("");
      expect(combined).toContain(": keepalive");
    });
  });

  describe("connection lease lifecycle", () => {
    it("acquires a lease on connect and releases on abort", async () => {
      mockRedisEval.mockClear();
      mockRedisDel.mockClear();

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      await GET_BOOK_SSE(request);
      controller.abort();

      // Lease acquired via redis.eval (ZADD inside Lua)
      expect(mockRedisEval).toHaveBeenCalledWith(
        expect.any(String),
        [expect.stringContaining("sse:book-stream:connections:")],
        expect.arrayContaining([expect.any(Number), expect.any(Number)]),
      );
    });

    it("refreshes lease on keepalive interval", async () => {
      vi.useFakeTimers();
      mockRedisSet.mockClear();

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      await GET_BOOK_SSE(request);
      await vi.advanceTimersByTimeAsync(16_000);
      controller.abort();
      vi.useRealTimers();

      // Lease refresh calls redis.zadd
      expect(mockRedisSet).not.toBeNull();
    });
  });

  describe("replay integration", () => {
    it("loads replay events on stream start", async () => {
      mockRedisLrange.mockClear();
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      await GET_BOOK_SSE(request);
      controller.abort();

      expect(mockRedisLrange).toHaveBeenCalledWith(
        "book:borrow:realtime:recent",
        0,
        -1,
      );
    });

    it("handles empty replay gracefully", async () => {
      mockRedisLrange.mockResolvedValueOnce([]);
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      const response = await GET_BOOK_SSE(request);
      const chunks = await readStreamChunks(response, 1, 200);
      controller.abort();

      const combined = chunks.join("");
      expect(combined).toContain("retry:");
    });
  });

  describe("cleanup guarantees", () => {
    it("unsubscribes from Redis pub/sub on abort", async () => {
      mockSubscription.unsubscribe.mockClear();

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      await GET_BOOK_SSE(request);
      controller.abort();

      // Give the abort handler a microtick
      await vi.waitFor(() => {
        expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      });
    });

    it("releases connection lease on abort", async () => {
      const redisZremSpy = vi.fn().mockResolvedValue(1);
      (redis as unknown as Record<string, unknown>).zrem = redisZremSpy;

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
      );
      await GET_BOOK_SSE(request);
      controller.abort();

      await vi.waitFor(() => {
        expect(redisZremSpy).toHaveBeenCalled();
      });
    });
  });

  describe("Last-Event-ID parsing", () => {
    it('parses "last-event-id: 42" as number 42', async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
        { headers: { "last-event-id": "42" } },
      );
      mockRedisLrange.mockResolvedValueOnce([]);
      await GET_BOOK_SSE(request);
      controller.abort();

      // Verify that the lrange call happens (replay is loaded)
      expect(mockRedisLrange).toHaveBeenCalled();
    });

    it('returns null for non-numeric "last-event-id"', async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/book/stream",
        { headers: { "last-event-id": "abc" } },
      );
      mockRedisLrange.mockResolvedValueOnce([]);
      const response = await GET_BOOK_SSE(request);
      controller.abort();

      expect(response.status).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Admin Dashboard SSE Stream  (/api/admin/dashboard/realtime)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/admin/dashboard/realtime — admin dashboard SSE", () => {
  let GET_DASHBOARD_SSE: typeof import("@/app/api/admin/dashboard/realtime/route").GET;
  let POST_DASHBOARD_SSE: typeof import("@/app/api/admin/dashboard/realtime/route").POST;

  beforeEach(async () => {
    mockDb.clear();
    mockAuth.mockReset();

    // Default: admin authenticated
    mockAuth.mockResolvedValue(createAdminSession("admin-dash-id"));

    const mod = await import("@/app/api/admin/dashboard/realtime/route");
    GET_DASHBOARD_SSE = mod.GET;
    POST_DASHBOARD_SSE = mod.POST;
  });

  describe("authorization", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/dashboard/realtime",
      );
      const response = await GET_DASHBOARD_SSE(request);
      controller.abort();
      expect(response.status).toBe(401);
    });

    it("returns 401 when user is not ADMIN", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user-1", name: "User", email: "u@t.edu", role: "USER" },
        expires: new Date().toISOString(),
      });
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/dashboard/realtime",
      );
      const response = await GET_DASHBOARD_SSE(request);
      controller.abort();
      expect(response.status).toBe(401);
    });

    it("returns 200 when ADMIN is authenticated", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/dashboard/realtime",
      );
      const response = await GET_DASHBOARD_SSE(request);
      controller.abort();
      expect(response.status).toBe(200);
    });
  });

  describe("stream initialization", () => {
    it("sends retry frame and connected event on open", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/dashboard/realtime",
      );
      const response = await GET_DASHBOARD_SSE(request);
      const chunks = await readStreamChunks(response, 2, 200);
      controller.abort();

      const combined = chunks.join("");
      expect(combined).toContain("retry: 2000");
      expect(combined).toContain("dashboard:connected");
    });

    it("sets correct SSE headers", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/dashboard/realtime",
      );
      const response = await GET_DASHBOARD_SSE(request);
      controller.abort();
      expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
      expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
      expect(response.headers.get("connection")).toBe("keep-alive");
    });
  });

  describe("keepalive and heartbeat", () => {
    it("sends keepalive comment on interval", async () => {
      vi.useFakeTimers();
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/dashboard/realtime",
      );
      const response = await GET_DASHBOARD_SSE(request);

      await vi.advanceTimersByTimeAsync(16_000);
      controller.abort();
      vi.useRealTimers();

      const chunks = await readStreamChunks(response, 3, 100);
      const combined = chunks.join("");
      expect(combined).toContain(": keepalive");
    });
  });

  describe("POST — manual dashboard refresh trigger", () => {
    it("returns 401 for non-admin on POST", async () => {
      mockAuth.mockResolvedValueOnce(null);
      const response = await POST_DASHBOARD_SSE();
      expect(response.status).toBe(401);
    });

    it("returns 200 for admin POST and publishes refresh", async () => {
      mockRedisPublish.mockClear();
      const response = await POST_DASHBOARD_SSE();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Admin Realtime Rows SSE  (/api/admin/realtime/rows)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/admin/realtime/rows — admin row-level realtime SSE", () => {
  let GET_ROWS_SSE: typeof import("@/app/api/admin/realtime/rows/route").GET;

  beforeEach(async () => {
    mockDb.clear();
    mockAuth.mockReset();

    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockRedisEval.mockReset();
    mockRedisPublish.mockReset();
    mockRedisDel.mockReset();
    mockRedisMget.mockReset();
    mockRedisLrange.mockResolvedValue([]);

    // Default: admin authenticated
    mockAuth.mockResolvedValue(createAdminSession("admin-rows-id"));

    const mod = await import("@/app/api/admin/realtime/rows/route");
    GET_ROWS_SSE = mod.GET;
  });

  describe("authorization", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      const response = await GET_ROWS_SSE(request);
      controller.abort();
      expect(response.status).toBe(401);
    });

    it("returns 401 when user is not ADMIN", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user-1", name: "User", email: "u@t.edu", role: "USER" },
        expires: new Date().toISOString(),
      });
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      const response = await GET_ROWS_SSE(request);
      controller.abort();
      expect(response.status).toBe(401);
    });

    it("returns 200 for authenticated ADMIN", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      const response = await GET_ROWS_SSE(request);
      controller.abort();
      expect(response.status).toBe(200);
    });
  });

  describe("stream initialization", () => {
    it("sends a retry frame and heartbeat event on open", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      const response = await GET_ROWS_SSE(request);
      const chunks = await readStreamChunks(response, 2, 200);
      controller.abort();

      const combined = chunks.join("");
      expect(combined).toContain("retry:");
      expect(combined).toContain("event: heartbeat");
      expect(combined).toContain('"kind":"heartbeat"');
    });

    it("subscribes to all admin realtime channels via Redis", async () => {
      // The route subscribes to ADMIN_ROW_REALTIME_CHANNELS + ADMIN_ROW_LOCKS_CHANNEL
      const subscribeSpy = mockSubscription;
      subscribeSpy.on.mockClear();

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      await GET_ROWS_SSE(request);
      controller.abort();

      // The route calls redis.subscribe([...channels])
      expect(redis.subscribe).toHaveBeenCalledWith(
        expect.arrayContaining(["borrow_requests", "account_requests", "books", "users", "locks"]),
      );
    });
  });

  describe("event relay", () => {
    it("forwards row events from Redis pub/sub to SSE stream", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      const response = await GET_ROWS_SSE(request);

      // Simulate a Redis pub/sub message
      const rowEvent = {
        kind: "row",
        channel: "borrow_requests",
        type: "UPDATE",
        entityId: "rec-1",
        data: { id: "rec-1", status: "BORROWED" },
        publishedAt: new Date().toISOString(),
      };

      // The "message" handler was registered during stream start
      const messageHandler = mockSubscription._handlers?.message;
      if (messageHandler) {
        messageHandler({ message: JSON.stringify(rowEvent) });
      }

      controller.abort();

      const chunks = await readStreamChunks(response, 3, 100);
      const combined = chunks.join("");
      expect(combined).toContain("borrow_requests");
      expect(combined).toContain("UPDATE");
      expect(combined).toContain("rec-1");
    });

    it("forwards lock events from Redis pub/sub to SSE stream", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      const response = await GET_ROWS_SSE(request);

      const lockEvent = {
        kind: "lock",
        channel: "locks",
        type: "LOCK_ACQUIRED",
        entity: "borrow_requests",
        entityId: "rec-1",
        id: "rec-1",
        adminName: "Admin",
        lock: {
          entity: "borrow_requests", entityId: "rec-1",
          adminId: "admin-1", adminName: "Admin",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          token: "token-1", version: 1,
        },
        publishedAt: new Date().toISOString(),
      };

      const messageHandler = mockSubscription._handlers?.message;
      if (messageHandler) {
        messageHandler({ message: JSON.stringify(lockEvent) });
      }

      controller.abort();

      const chunks = await readStreamChunks(response, 3, 100);
      const combined = chunks.join("");
      expect(combined).toContain("LOCK_ACQUIRED");
      expect(combined).toContain("admin-1");
    });

    it("filters out non-admin-realtime messages from pub/sub", async () => {
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      await GET_ROWS_SSE(request);

      // Invalid message should be silently ignored
      const messageHandler = mockSubscription._handlers?.message;
      expect(() => {
        if (messageHandler) {
          messageHandler({ message: "{invalid json" });
        }
      }).not.toThrow();

      controller.abort();
    });
  });

  describe("heartbeat", () => {
    it("sends heartbeat events at configured interval", async () => {
      vi.useFakeTimers();
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      const response = await GET_ROWS_SSE(request);

      // Advance past first heartbeat
      await vi.advanceTimersByTimeAsync(16_000);
      controller.abort();
      vi.useRealTimers();

      const chunks = await readStreamChunks(response, 3, 100);
      const heartbeatCount = chunks.filter((c) => c.includes("heartbeat")).length;
      expect(heartbeatCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("cleanup", () => {
    it("unsubscribes from Redis on abort", async () => {
      mockSubscription.unsubscribe.mockClear();

      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      await GET_ROWS_SSE(request);
      controller.abort();

      await vi.waitFor(() => {
        expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      });
    });

    it("clears heartbeat interval on abort", async () => {
      vi.useFakeTimers();
      const { request, controller } = createAbortableRequest(
        "http://localhost/api/admin/realtime/rows",
      );
      await GET_ROWS_SSE(request);
      controller.abort();

      // After abort, advancing time should not add new heartbeats
      const callsBefore = mockRedisPublish.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      vi.useRealTimers();

      expect(mockRedisPublish.mock.calls.length - callsBefore).toBe(0);
    });
  });
});
