/**
 * instances.ts — Shared mock function instances.
 *
 * These are created ONCE at import time and referenced both by:
 * 1. the setup.ts file (to define vi.mock factories)
 * 2. individual test files (to configure return values and assert calls)
 *
 * IMPORTANT: This file must NOT import vi.mock itself.
 */
import { vi } from "vitest";
import { InMemoryDb } from "./db-mock";

// ─── Mock DB Instance ──────────────────────────────────────────────────────
export const mockDb = new InMemoryDb();

// ─── Auth Mocks ────────────────────────────────────────────────────────────
export const mockAuth = vi.fn();
export const mockSignIn = vi.fn();
export const mockSignOut = vi.fn();

// ─── Next.js Mocks ─────────────────────────────────────────────────────────
export const mockHeaders = vi.fn();
export const mockRevalidatePath = vi.fn();
export const mockRevalidateTag = vi.fn();
export const mockRedirect = vi.fn();

// ─── Broadcast / Realtime Mocks ────────────────────────────────────────────
// These return resolved promises so fire-and-forget callers can use .catch()
export const mockBroadcastAdminDashboard = vi.fn(async () => {});
export const mockBroadcastBookAvailability = vi.fn(async () => {});
export const mockPublishEvent = vi.fn(async () => {});
export const mockPublishRoleChangeEvent = vi.fn(async () => {});

// ─── Redis Mocks ───────────────────────────────────────────────────────────
export const mockRedisGet = vi.fn();
export const mockRedisSet = vi.fn();
export const mockRedisEval = vi.fn();
export const mockRedisPublish = vi.fn();
export const mockRedisMget = vi.fn();
export const mockRedisDel = vi.fn();

// ─── Workflow Mock ─────────────────────────────────────────────────────────
export const mockWorkflowTrigger = vi.fn(async () => {});

// ─── Rate Limit Control ────────────────────────────────────────────────────
let _rateLimitBypass = true;
export const bypassRateLimit = (bypass = true) => { _rateLimitBypass = bypass; };
export const isRateLimitBypassed = () => _rateLimitBypass;
