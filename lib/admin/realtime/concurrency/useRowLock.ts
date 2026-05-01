"use client";

/**
 * useRowLock — row-level optimistic locking for admin tables.
 *
 * Changes from the original:
 *  1. NO longer opens its own EventSource — uses the singleton realtimeClient.
 *  2. Registers a `message` listener for `kind: "lock"` events only.
 *  3. Calls `useRealtimeCore` with an `onResync` that re-fetches all locks for
 *     currently-visible rows after every SSE reconnect.
 *  4. Runs a **TTL sweep** every 10 s: any lock whose `expiresAt` is in the
 *     past is removed from client state — prevents ghost locks even if the
 *     LOCK_RELEASED event was missed during a disconnect.
 *  5. Lock heartbeat (PATCH every 20 s while a row is active) is unchanged.
 */

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ADMIN_ROW_SYNC_ENDPOINT,
  type AdminRealtimeEntity,
  type AdminRealtimeEvent,
  type AdminRowLock,
} from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";
import { onMessage } from "@/lib/realtime/realtimeClient";
import { useRealtimeCore } from "@/lib/admin/realtime/concurrency/useRealtimeCore";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROW_LOCK_HEARTBEAT_MS = 20_000;
const LOCK_TTL_SWEEP_MS = 10_000; // how often to sweep for expired locks
const isDevelopment = process.env.NODE_ENV === "development";

const devLog = (
  level: "debug" | "info" | "error",
  message?: unknown,
  ...optionalParams: unknown[]
) => {
  if (!isDevelopment) return;
  console[level](message, ...optionalParams);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UseRowLockOptions = {
  entity: AdminRealtimeEntity;
  rowIds: string[];
  currentAdminId: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createLocksQuery = (entity: AdminRealtimeEntity, rowIds: string[]) => {
  const params = new URLSearchParams({ entity });
  if (rowIds.length > 0) {
    params.set("ids", rowIds.join(","));
  }
  return params.toString();
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useRowLock = ({
  entity,
  rowIds,
  currentAdminId,
}: UseRowLockOptions) => {
  const [locks, setLocks] = useState<Record<string, AdminRowLock | null>>({});
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const activeTokenRef = useRef<string | null>(null);
  const heartbeatRowIdRef = useRef<string | null>(null);
  const activeRowIdRef = useRef<string | null>(null);

  // Stable ref so the resync callback always has the latest rowIds
  const rowIdsRef = useRef(rowIds);
  useEffect(() => { rowIdsRef.current = rowIds; }, [rowIds]);

  const rowIdsString = rowIds.join(",");

  // ---------------------------------------------------------------------------
  // Initial lock fetch (when visible row IDs change)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const fetchLocks = async () => {
      try {
        const response = await fetch(
          `/api/admin/locks?${createLocksQuery(entity, rowIdsString.split(",").filter(Boolean))}`,
          { credentials: "include", cache: "no-store" },
        );

        if (!response.ok) return;

        const payload = (await response.json()) as {
          locks?: Record<string, AdminRowLock | null>;
        };

        if (payload.locks) {
          setLocks(payload.locks);
        }
      } catch (error) {
        devLog("error", "[useRowLock] Failed to fetch row locks:", error);
      }
    };

    if (rowIdsString.length > 0) {
      void fetchLocks();
    } else {
      startTransition(() => setLocks({}));
    }
  }, [entity, rowIdsString]);

  // ---------------------------------------------------------------------------
  // Post-reconnect resync — re-fetch locks for all currently-visible rows
  // ---------------------------------------------------------------------------

  const resyncLocks = useCallback(async () => {
    const ids = rowIdsRef.current;
    if (ids.length === 0) return;

    devLog(
      "info",
      `[useRowLock:${entity}] Reconnected — resyncing ${ids.length} lock(s)…`,
    );

    try {
      const response = await fetch(
        `${ADMIN_ROW_SYNC_ENDPOINT}?${createLocksQuery(entity, ids)}`,
        { credentials: "include", cache: "no-store" },
      );

      if (!response.ok) return;

      const payload = (await response.json()) as {
        locks?: Record<string, AdminRowLock | null>;
      };

      if (payload.locks) {
        setLocks(payload.locks);

        const activeRowId = activeRowIdRef.current;
        const serverLock = activeRowId ? payload.locks[activeRowId] : null;
        if (
          activeRowId &&
          (!serverLock ||
            serverLock.adminId !== currentAdminId ||
            serverLock.token !== activeTokenRef.current)
        ) {
          setActiveRowId(null);
          activeTokenRef.current = null;
          heartbeatRowIdRef.current = null;
          activeRowIdRef.current = null;
        }

        devLog("info", `[useRowLock:${entity}] Lock resync complete.`);
      }
    } catch (error) {
      devLog("error", `[useRowLock:${entity}] Lock resync failed:`, error);
    }
  }, [currentAdminId, entity]);

  // ---------------------------------------------------------------------------
  // Shared SSE lifecycle (connect / reconnect / resync)
  // ---------------------------------------------------------------------------

  useRealtimeCore({ onResync: resyncLocks });

  // ---------------------------------------------------------------------------
  // SSE lock-event listener (uses singleton — no own EventSource)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as AdminRealtimeEvent;

        if (parsed.kind !== "lock" || parsed.entity !== entity) return;

        const eventId = parsed.id || parsed.entityId;

        devLog(
          "debug",
          `[useRowLock:${entity}] Lock event:`,
          parsed.type,
          eventId,
        );

        if (parsed.type === "LOCK_RELEASED") {
          setLocks((current) => {
            const copy = { ...current };
            delete copy[eventId];
            return copy;
          });
        } else {
          setLocks((current) => ({
            ...current,
            [eventId]: parsed.lock ?? null,
          }));
        }
      } catch (error) {
        devLog("error", `[useRowLock:${entity}] Failed to process lock event:`, error);
      }
    };

    const unsub = onMessage(handleMessage);
    return unsub;
  }, [entity]);

  // ---------------------------------------------------------------------------
  // Client-side TTL sweep — runs every LOCK_TTL_SWEEP_MS
  // Prevents ghost locks when LOCK_RELEASED events are missed during a disconnect.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      setLocks((current) => {
        const expired = Object.entries(current).filter(
          ([, lock]) => lock !== null && new Date(lock!.expiresAt).getTime() < now,
        );

        if (expired.length === 0) return current;

        devLog(
          "info",
          `[useRowLock:${entity}] TTL sweep removed ${expired.length} expired lock(s).`,
        );

        const next = { ...current };
        for (const [id] of expired) {
          delete next[id];
        }
        return next;
      });
    };

    const interval = setInterval(sweep, LOCK_TTL_SWEEP_MS);
    return () => clearInterval(interval);
  }, [entity]);

  // ---------------------------------------------------------------------------
  // Lock CRUD helpers
  // ---------------------------------------------------------------------------

  const syncLock = useCallback(
    async (
      method: "POST" | "PATCH" | "DELETE",
      entityId: string,
      token?: string | null,
    ): Promise<{
      success: boolean;
      lock?: AdminRowLock | null;
      message?: string;
    }> => {
      const response = await fetch("/api/admin/locks", {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          entityId,
          token: method === "DELETE" ? (token ?? activeTokenRef.current) : undefined,
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        lock?: AdminRowLock | null;
        message?: string;
      };

      if (payload.lock !== undefined) {
        setLocks((current) => ({
          ...current,
          [entityId]: payload.lock ?? null,
        }));
      }

      return {
        success: response.ok && !!payload.success,
        lock: payload.lock,
        message: payload.message,
      };
    },
    [entity],
  );

  const acquireRowLock = useCallback(
    async (entityId: string) => {
      devLog("debug", `[useRowLock:${entity}] Acquiring lock for id: ${entityId}`);
      const result = await syncLock("POST", entityId);

      if (result.success) {
        devLog("debug", `[useRowLock:${entity}] Lock acquired for: ${entityId}`);
        setActiveRowId(entityId);
        activeTokenRef.current = result.lock?.token ?? null;
        heartbeatRowIdRef.current = entityId;
        activeRowIdRef.current = entityId;
      }

      return result;
    },
    [entity, syncLock],
  );

  const refreshRowLock = useCallback(
    async (entityId: string) => syncLock("PATCH", entityId),
    [syncLock],
  );

  const releaseRowLock = useCallback(
    async (entityId: string) => {
      devLog("debug", `[useRowLock:${entity}] Releasing lock for id: ${entityId}`);

      const previousLock = locks[entityId];

      // Immediately clear from local state for instant UI feedback
      setLocks((current) => {
        const copy = { ...current };
        delete copy[entityId];
        return copy;
      });

      const token = activeTokenRef.current;

      if (heartbeatRowIdRef.current === entityId) {
        heartbeatRowIdRef.current = null;
        activeTokenRef.current = null;
        activeRowIdRef.current = null;
      }

      if (activeRowId === entityId) {
        setActiveRowId((current) => (current === entityId ? null : current));
      }

      try {
        const result = await syncLock("DELETE", entityId, token);

        if (!result.success) {
          throw new Error(result.message || "Failed to release lock");
        }

        return result;
      } catch (error) {
        devLog(
          "error",
          `[useRowLock:${entity}] Release failed — restoring lock:`,
          error,
        );

        // Rollback: restore the previous lock state
        setLocks((current) => ({
          ...current,
          [entityId]: previousLock,
        }));

        // If it was our lock, restore the active state too
        if (previousLock?.adminId === currentAdminId) {
          setActiveRowId(entityId);
          activeTokenRef.current = previousLock.token;
          heartbeatRowIdRef.current = entityId;
          activeRowIdRef.current = entityId;
        }

        return { success: false, message: "Failed to release lock" };
      }
    },
    [activeRowId, currentAdminId, entity, locks, syncLock],
  );

  // ---------------------------------------------------------------------------
  // Lock heartbeat — keeps the Redis TTL alive while a row is being edited
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!activeRowId) return;

    heartbeatRowIdRef.current = activeRowId;
    activeRowIdRef.current = activeRowId;

    const interval = window.setInterval(() => {
      if (!heartbeatRowIdRef.current) return;
      void refreshRowLock(heartbeatRowIdRef.current);
    }, ROW_LOCK_HEARTBEAT_MS);

    return () => window.clearInterval(interval);
  }, [activeRowId, refreshRowLock]);

  // Auto-clear activeRowId if the lock disappears (e.g. TTL sweep or stolen)
  useEffect(() => {
    if (activeRowId && locks[activeRowId] == null) {
      startTransition(() => setActiveRowId(null));
      activeTokenRef.current = null;
      heartbeatRowIdRef.current = null;
      activeRowIdRef.current = null;
    }
  }, [activeRowId, locks]);

  // ---------------------------------------------------------------------------
  // Convenience selectors
  // ---------------------------------------------------------------------------

  const lockForRow = useCallback(
    (entityId: string) => locks[entityId] ?? null,
    [locks],
  );

  const isLockedByOther = useCallback(
    (entityId: string) => {
      const lock = lockForRow(entityId);
      return !!lock && lock.adminId !== currentAdminId;
    },
    [currentAdminId, lockForRow],
  );

  const isLockedByCurrentAdmin = useCallback(
    (entityId: string) => {
      const lock = lockForRow(entityId);
      return !!lock && lock.adminId === currentAdminId;
    },
    [currentAdminId, lockForRow],
  );

  // ---------------------------------------------------------------------------
  // Return memoised API
  // ---------------------------------------------------------------------------

  return useMemo(
    () => ({
      locks,
      activeRowId,
      setActiveRowId,
      acquireRowLock,
      refreshRowLock,
      releaseRowLock,
      lockForRow,
      isLockedByOther,
      isLockedByCurrentAdmin,
    }),
    [
      locks,
      activeRowId,
      acquireRowLock,
      refreshRowLock,
      releaseRowLock,
      lockForRow,
      isLockedByOther,
      isLockedByCurrentAdmin,
    ],
  );
};
