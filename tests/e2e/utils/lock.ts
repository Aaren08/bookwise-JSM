import { Page, expect } from "@playwright/test";
import { type AdminRealtimeEntity } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";
import type { AdminRowLock } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";
import { getSseEvents } from "./sse";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LOCKS_API_URL = "/api/admin/locks";
export const SYNC_API_URL = "/api/admin/sync";

export const LOCK_TTL_MS = 60_000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const LOCK_TTL_SWEEP_MS = 10_000;

export const LOCK_POLL_TIMEOUT = 15_000;
export const RELEASE_POLL_TIMEOUT = 20_000;
export const TTL_POLL_TIMEOUT = LOCK_TTL_MS + 15_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LockOperationResult = {
  success: boolean;
  lock?: AdminRowLock | null;
  message?: string;
  reason?: string;
};

// ---------------------------------------------------------------------------
// API Helpers — use page.request to piggyback on the page's auth cookies
// ---------------------------------------------------------------------------

export async function getLocksViaApi(
  page: Page,
  entity: AdminRealtimeEntity,
  ids: string[],
): Promise<Record<string, AdminRowLock | null>> {
  const params = new URLSearchParams({ entity });
  if (ids.length > 0) {
    params.set("ids", ids.join(","));
  }
  const response = await page.request.get(
    `${LOCKS_API_URL}?${params.toString()}`,
  );
  if (!response.ok()) return {};
  const payload = (await response.json()) as {
    locks?: Record<string, AdminRowLock | null>;
  };
  return payload.locks ?? {};
}

export async function acquireLockViaApi(
  page: Page,
  entity: AdminRealtimeEntity,
  entityId: string,
): Promise<LockOperationResult> {
  const response = await page.request.post(LOCKS_API_URL, {
    data: { entity, entityId },
  });
  const payload = (await response.json()) as LockOperationResult;
  return { ...payload, success: response.ok() && !!payload.success };
}

export async function releaseLockViaApi(
  page: Page,
  entity: AdminRealtimeEntity,
  entityId: string,
  token: string,
): Promise<LockOperationResult> {
  const response = await page.request.delete(LOCKS_API_URL, {
    data: { entity, entityId, token },
  });
  const payload = (await response.json()) as LockOperationResult;
  return { ...payload, success: response.ok() && !!payload.success };
}

export async function refreshLockViaApi(
  page: Page,
  entity: AdminRealtimeEntity,
  entityId: string,
  token: string,
): Promise<LockOperationResult> {
  const response = await page.request.patch(LOCKS_API_URL, {
    data: { entity, entityId, token },
  });
  const payload = (await response.json()) as LockOperationResult;
  return { ...payload, success: response.ok() && !!payload.success };
}

export async function getLockForRowViaApi(
  page: Page,
  entity: AdminRealtimeEntity,
  entityId: string,
): Promise<AdminRowLock | null> {
  const locks = await getLocksViaApi(page, entity, [entityId]);
  return locks[entityId] ?? null;
}

export async function syncLocksViaApi(
  page: Page,
  entity: AdminRealtimeEntity,
  ids: string[],
): Promise<Record<string, AdminRowLock | null>> {
  const params = new URLSearchParams({ entity });
  if (ids.length > 0) {
    params.set("ids", ids.join(","));
  }
  const response = await page.request.get(
    `${SYNC_API_URL}?${params.toString()}`,
  );
  if (!response.ok()) return {};
  const payload = (await response.json()) as {
    locks?: Record<string, AdminRowLock | null>;
  };
  return payload.locks ?? {};
}

// ---------------------------------------------------------------------------
// SSE Lock Event Monitoring
// ---------------------------------------------------------------------------

export type LockEventRecord = {
  type: "LOCK_ACQUIRED" | "LOCK_RELEASED";
  entity: string;
  entityId: string;
  adminName?: string;
  timestamp: string;
};

export async function getLockEventsFromSse(
  page: Page,
): Promise<LockEventRecord[]> {
  const events = await getSseEvents(page);
  return events
    .filter(
      (e) =>
        e.type === "message" &&
        typeof e.data === "object" &&
        e.data !== null &&
        (e.data as Record<string, unknown>).kind === "lock",
    )
    .map((e) => {
      const data = e.data as Record<string, unknown>;
      return {
        type: data.type as LockEventRecord["type"],
        entity: data.entity as string,
        entityId: data.entityId as string,
        adminName: data.adminName as string | undefined,
        timestamp: data.publishedAt as string,
      };
    });
}

export async function waitForLockEvent(
  page: Page,
  predicate: (event: LockEventRecord) => boolean,
  timeout = LOCK_POLL_TIMEOUT,
) {
  await expect
    .poll(
      async () => {
        const lockEvents = await getLockEventsFromSse(page);
        return lockEvents.some(predicate);
      },
      {
        timeout,
        message: `Lock event matching predicate not received within ${timeout}ms`,
      },
    )
    .toBe(true);
}

export async function waitForLockAcquired(
  page: Page,
  entityId: string,
  adminName?: string,
  timeout = LOCK_POLL_TIMEOUT,
) {
  await waitForLockEvent(
    page,
    (e) =>
      e.type === "LOCK_ACQUIRED" &&
      e.entityId === entityId &&
      (!adminName || e.adminName === adminName),
    timeout,
  );
}

export async function waitForLockReleased(
  page: Page,
  entityId: string,
  timeout = RELEASE_POLL_TIMEOUT,
) {
  await waitForLockEvent(
    page,
    (e) => e.type === "LOCK_RELEASED" && e.entityId === entityId,
    timeout,
  );
}

// ---------------------------------------------------------------------------
// Lock State Verification (poll-based)
// ---------------------------------------------------------------------------

export async function expectLockExists(
  page: Page,
  entity: AdminRealtimeEntity,
  entityId: string,
  adminName?: string,
  timeout = LOCK_POLL_TIMEOUT,
) {
  await expect
    .poll(
      async () => {
        const lock = await getLockForRowViaApi(page, entity, entityId);
        if (!lock) return null;
        if (adminName && lock.adminName !== adminName) return null;
        return lock;
      },
      {
        timeout,
        message: `Lock for ${entity}:${entityId} not found within ${timeout}ms`,
      },
    )
    .not.toBeNull();
}

export async function expectLockNotExists(
  page: Page,
  entity: AdminRealtimeEntity,
  entityId: string,
  timeout = RELEASE_POLL_TIMEOUT,
) {
  await expect
    .poll(
      async () => {
        const lock = await getLockForRowViaApi(page, entity, entityId);
        return lock;
      },
      {
        timeout,
        message: `Lock for ${entity}:${entityId} still exists after ${timeout}ms`,
      },
    )
    .toBeNull();
}

// ---------------------------------------------------------------------------
// Heartbeat Simulation Helpers
// ---------------------------------------------------------------------------

export async function simulateHeartbeat(
  page: Page,
  entity: AdminRealtimeEntity,
  entityId: string,
  token: string,
  count = 3,
  intervalMs = HEARTBEAT_INTERVAL_MS,
) {
  const results: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const result = await refreshLockViaApi(page, entity, entityId, token);
    results.push(result.success);
    if (i < count - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Lock Cleanup
// ---------------------------------------------------------------------------

/**
 * Release all locks held by a given admin for a specific entity.
 * Fetches current locks for the given IDs and releases any owned by the admin.
 */
export async function releaseAdminLocks(
  page: Page,
  entity: AdminRealtimeEntity,
  entityIds: string[],
) {
  const locks = await getLocksViaApi(page, entity, entityIds);
  const results: LockOperationResult[] = [];
  for (const [entityId, lock] of Object.entries(locks)) {
    if (lock) {
      const result = await releaseLockViaApi(
        page,
        entity,
        entityId,
        lock.token,
      );
      results.push(result);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Console & Network Diagnostics
// ---------------------------------------------------------------------------

export type LockDiagnostics = {
  errors: string[];
  lockApiCalls: Array<{
    method: string;
    url: string;
    status: number;
    timestamp: string;
  }>;
};

export function createLockDiagnostics(page: Page): LockDiagnostics {
  const diagnostics: LockDiagnostics = {
    errors: [],
    lockApiCalls: [],
  };

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("Failed to load resource")) return;
    if (text.includes("EventSource")) return;
    if (
      text.includes("lock") ||
      text.includes("heartbeat") ||
      text.includes("concurrency")
    ) {
      diagnostics.errors.push(`[LOCK_CONSOLE:${msg.type()}] ${text}`);
    }
  });

  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/admin/locks") && !url.includes("/api/admin/sync")) {
      return;
    }
    diagnostics.lockApiCalls.push({
      method: res.request().method(),
      url: url.split("?")[0],
      status: res.status(),
      timestamp: new Date().toISOString(),
    });
    if (res.status() >= 400) {
      diagnostics.errors.push(
        `[LOCK_HTTP ${res.status()}] ${res.request().method()} ${url}`,
      );
    }
  });

  return diagnostics;
}

export function getLockDiagnosticSummary(diagnostics: LockDiagnostics): string {
  const parts: string[] = [];
  if (diagnostics.errors.length > 0) {
    parts.push(`Errors: ${diagnostics.errors.join("; ")}`);
  }
  if (diagnostics.lockApiCalls.length > 0) {
    const failed = diagnostics.lockApiCalls.filter(
      (c) => c.status >= 400,
    ).length;
    parts.push(
      `API calls: ${diagnostics.lockApiCalls.length} (${failed} failed)`,
    );
  }
  return parts.length > 0 ? parts.join(" | ") : "No diagnostics";
}

// ---------------------------------------------------------------------------
// Common Locator Helpers
// ---------------------------------------------------------------------------

/**
 * Find the table row containing the given text (email, name, etc.)
 */
export function findTableRow(page: Page, rowText: string) {
  return page.getByRole("row").filter({ hasText: rowText });
}

/**
 * Get the lock indicator locator within a specific row.
 */
export function getLockIndicatorInRow(row: ReturnType<typeof findTableRow>) {
  return row.locator(".row-lock_badge");
}

/**
 * Wait for lock indicator to appear in a specific row.
 */
export async function expectLockIndicatorVisible(
  row: ReturnType<typeof findTableRow>,
  adminName: string,
  timeout = LOCK_POLL_TIMEOUT,
) {
  const indicator = getLockIndicatorInRow(row);
  await expect(indicator).toBeVisible({ timeout });
  await expect(indicator).toHaveAttribute(
    "aria-label",
    `Currently being edited by ${adminName}`,
  );
}

/**
 * Wait for lock indicator to disappear from a specific row.
 */
export async function expectLockIndicatorNotVisible(
  row: ReturnType<typeof findTableRow>,
  timeout = RELEASE_POLL_TIMEOUT,
) {
  const indicator = getLockIndicatorInRow(row);
  await expect(indicator).not.toBeVisible({ timeout });
}

/**
 * Expect buttons in a row to be disabled.
 */
export async function expectRowButtonsDisabled(
  row: ReturnType<typeof findTableRow>,
) {
  const approveBtn = row.getByRole("button", { name: "Approve Account" });
  const rejectBtn = row.getByRole("button", { name: "Reject account" });

  await expect(approveBtn).toBeDisabled();
  await expect(rejectBtn).toBeDisabled();
}

/**
 * Expect buttons in a row to be enabled.
 */
export async function expectRowButtonsEnabled(
  row: ReturnType<typeof findTableRow>,
) {
  const approveBtn = row.getByRole("button", { name: "Approve Account" });
  const rejectBtn = row.getByRole("button", { name: "Reject account" });

  await expect(approveBtn).toBeEnabled();
  await expect(rejectBtn).toBeEnabled();
}

/**
 * Verify aria-disabled semantics on lock-affected controls.
 */
export async function expectLockAccessibilitySemantics(
  row: ReturnType<typeof findTableRow>,
  adminName: string,
) {
  const indicator = getLockIndicatorInRow(row);
  await expect(indicator).toHaveAttribute("tabindex", "0");
  await expect(indicator).toHaveAttribute("role", "img");
  await expect(indicator).toHaveAttribute(
    "aria-label",
    `Currently being edited by ${adminName}`,
  );

  const approveBtn = row.getByRole("button", { name: "Approve Account" });
  await expect(approveBtn).toHaveAttribute("disabled");
  const rejectBtn = row.getByRole("button", { name: "Reject account" });
  await expect(rejectBtn).toHaveAttribute("disabled");
}

/**
 * Verify a toast/notification message appeared.
 */
export async function expectToastVisible(
  page: Page,
  message: string,
  timeout = 5_000,
) {
  await expect(page.getByText(message).first()).toBeVisible({ timeout });
}
