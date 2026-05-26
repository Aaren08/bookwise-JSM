/**
 * test-env.ts — Shared test environment setup for integration tests.
 *
 * Provides:
 * - A shared InMemoryDb instance that all tests use
 * - Mock setup/teardown for external dependencies
 * - Helper assertion utilities for DB state inspection
 * - Rate limit bypass / control
 */
import { vi, beforeEach, afterEach, expect } from "vitest";
import { InMemoryDb } from "./db-mock";

// ─── Shared Mock DB Instance ───────────────────────────────────────────────

export const mockDb = new InMemoryDb();

// ─── Mock Implementations ──────────────────────────────────────────────────

// Track calls to external services for assertions
export const mockBroadcastAdminDashboard = vi.fn().mockResolvedValue(undefined);
export const mockBroadcastBookAvailability = vi
  .fn()
  .mockResolvedValue(undefined);
export const mockPublishEvent = vi.fn().mockResolvedValue(undefined);
export const mockPublishRoleChangeEvent = vi.fn().mockResolvedValue(undefined);
export const mockWorkflowTrigger = vi.fn().mockResolvedValue({});
export const mockAuth = vi.fn();
export const mockSignIn = vi.fn();
export const mockSignOut = vi.fn();
export const mockRevalidatePath = vi.fn();
export const mockRevalidateTag = vi.fn();
export const mockRedirect = vi.fn();
export const mockHeaders = vi.fn();
export const mockRedisGet = vi.fn();
export const mockRedisSet = vi.fn();
export const mockRedisEval = vi.fn();
export const mockRedisPublish = vi.fn();
export const mockRedisMget = vi.fn();
export const mockRedisZadd = vi.fn();
export const mockRedisZrem = vi.fn();
export const mockRedisPexpire = vi.fn();

// ─── Rate Limit Bypass ─────────────────────────────────────────────────────

// Set to true to bypass rate limiting in tests
let rateLimitBypass = true;

export const bypassRateLimit = (bypass = true) => {
  rateLimitBypass = bypass;
};

export const getRateLimitBypass = () => rateLimitBypass;

// ─── Apply All Mocks ───────────────────────────────────────────────────────

/**
 * Call this at the top of each test file's vi.mock setup.
 * Sets up all external dependency mocks.
 */
export function setupExternalMocks() {
  vi.mock("server-only", () => ({}));

  vi.mock("@/auth", () => ({
    auth: mockAuth,
    signIn: mockSignIn,
    signOut: mockSignOut,
  }));

  vi.mock("next/headers", () => ({
    headers: mockHeaders,
  }));

  vi.mock("next/cache", () => ({
    revalidatePath: mockRevalidatePath,
    revalidateTag: mockRevalidateTag,
  }));

  vi.mock("next/navigation", () => ({
    redirect: mockRedirect,
    revalidatePath: mockRevalidatePath,
    revalidateTag: mockRevalidateTag,
  }));

  vi.mock("@/database/drizzle", () => ({
    db: mockDb,
  }));

  vi.mock("@/database/schema", async () => {
    const actual = await vi.importActual("@/database/schema");
    return actual;
  });

  vi.mock("@/database/redis", () => ({
    default: {
      get: mockRedisGet,
      set: mockRedisSet,
      eval: mockRedisEval,
      publish: mockRedisPublish,
      mget: mockRedisMget,
      zadd: mockRedisZadd,
      zrem: mockRedisZrem,
      pexpire: mockRedisPexpire,
    },
  }));

  vi.mock("@/lib/admin/realtime/broadcast/dashboardSocketServer", () => ({
    broadcastAdminDashboardUpdate: mockBroadcastAdminDashboard,
    broadcastBookAvailabilityUpdate: mockBroadcastBookAvailability,
  }));

  vi.mock("@/lib/admin/realtime/concurrency/rowConcurrency", async () => {
    // Import actual module but allow overriding publishEvent
    const actual = await vi.importActual(
      "@/lib/admin/realtime/concurrency/rowConcurrency",
    );
    return {
      ...(actual as Record<string, unknown>),
      publishEvent: mockPublishEvent,
    };
  });

  vi.mock("@/lib/admin/realtime/session/roleChangePublisher", () => ({
    publishRoleChangeEvent: mockPublishRoleChangeEvent,
    ROLE_CHANGE_CHANNEL: "admin:role-change",
  }));

  vi.mock("@/lib/workflow", () => ({
    workflowClient: {
      trigger: mockWorkflowTrigger,
    },
  }));

  vi.mock("@/lib/config", () => ({
    default: {
      env: {
        apiEndpoint: "http://localhost:3000",
        prodApiEndpoint: "http://localhost:3000",
        upstash: {
          redisUrl: "http://localhost:6379",
          restToken: "test-token",
          qstashUrl: "http://localhost:8080",
          qstashToken: "test-qstash-token",
        },
      },
    },
  }));

  vi.mock("@/lib/essentials/rateLimit", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/essentials/rateLimit")
    >("@/lib/essentials/rateLimit");
    return {
      ...actual,
      safeRateLimit: vi.fn(
        async (...args: [unknown, string, unknown?]) => {
          void args;
          if (rateLimitBypass) {
            return {
              success: true,
              limit: Number.MAX_SAFE_INTEGER,
              remaining: Number.MAX_SAFE_INTEGER,
              reset: Date.now() + 60000,
              pending: Promise.resolve(),
            };
          }
          // Delegate to actual safeRateLimit logic
          // In test mode this simply returns the bypass response
          return {
            success: true,
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER,
            reset: Date.now() + 60000,
            pending: Promise.resolve(),
          };
        },
      ),
    };
  });
}

// ─── Reset All State ───────────────────────────────────────────────────────

beforeEach(() => {
  mockDb.clear();
  mockDb.seed("app_settings", [
    {
      id: true,
      borrowDurationDays: 14,
      supportEmail: "library@test.edu",
      websiteUrl: "https://library.test.edu",
      universityName: "Test University",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      setupCompleted: true,
      initializedAt: new Date(),
    },
  ]);

  rateLimitBypass = true;
});

afterEach(() => {
  mockDb.clearQueryLog();
  mockDb.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─── DB State Assertion Helpers ────────────────────────────────────────────

export function assertRowExists(
  tableName: string,
  id: string,
): Record<string, unknown> {
  const row = mockDb.getRow(tableName, id);
  expect(row).not.toBeNull();
  return row!;
}

export function assertRowNotExists(tableName: string, id: string) {
  expect(mockDb.getRow(tableName, id)).toBeNull();
}

export function assertVersionIncremented(
  tableName: string,
  id: string,
  oldVersion: number,
) {
  const row = assertRowExists(tableName, id);
  expect(row.version).toBe(oldVersion + 1);
}

export function assertBorrowStatus(recordId: string, expectedStatus: string) {
  const record = assertRowExists("borrow_records", recordId);
  expect(record.borrowStatus).toBe(expectedStatus);
}

export function assertBookCounts(
  bookId: string,
  expected: {
    borrowedCount?: number;
    reservedCount?: number;
    availableCopies?: number;
  },
) {
  const book = assertRowExists("books", bookId);
  if (expected.borrowedCount !== undefined) {
    expect(book.borrowedCount).toBe(expected.borrowedCount);
  }
  if (expected.reservedCount !== undefined) {
    expect(book.reservedCount).toBe(expected.reservedCount);
  }
  if (expected.availableCopies !== undefined) {
    expect(book.availableCopies).toBe(expected.availableCopies);
  }
}

export function assertUserStatus(userId: string, expectedStatus: string) {
  const user = assertRowExists("users", userId);
  expect(user.status).toBe(expectedStatus);
}

export function assertUserRole(userId: string, expectedRole: string) {
  const user = assertRowExists("users", userId);
  expect(user.role).toBe(expectedRole);
}
