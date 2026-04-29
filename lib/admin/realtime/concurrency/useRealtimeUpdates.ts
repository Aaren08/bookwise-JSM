"use client";

/**
 * useRealtimeUpdates — subscribe to row-level CREATE/UPDATE/DELETE events.
 *
 * Changes from the original:
 *  - NO longer opens its own EventSource.
 *  - Registers a `message` listener on the singleton realtimeClient.
 *  - Lifecycle (connect / disconnect / reconnect) is fully delegated to
 *    `useRealtimeCore`, which must be mounted somewhere above in the tree
 *    (or within the same component via composition — see note below).
 *
 * If you use `useRealtimeUpdates` and `useRowLock` in the same component,
 * each calls `useRealtimeCore` internally. The reference counter in
 * realtimeClient ensures only one actual EventSource is ever open.
 */

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  type AdminRealtimeEntity,
  type AdminRealtimeEvent,
  ADMIN_ROW_SYNC_ENDPOINT,
} from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";
import { onMessage } from "@/lib/realtime/realtimeClient";
import { useRealtimeCore } from "@/lib/admin/realtime/concurrency/useRealtimeCore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IdentifiableRow = {
  id: string;
  updatedAt?: string | Date | null;
  version?: number | null;
};

type SortOrder = "asc" | "desc";

type UseRealtimeUpdatesOptions<T extends IdentifiableRow> = {
  entity: AdminRealtimeEntity;
  setItems: Dispatch<SetStateAction<T[]>>;
  sortFn?: (a: T, b: T, order: SortOrder) => number;
  sortOrder?: SortOrder;
  pinnedRowId?: string | null;
  matchesFilter?: (item: T) => boolean;
  /**
   * Optional callback invoked after every SSE reconnect.
   * The parent can use it to re-fetch the current page of rows.
   */
  onResync?: () => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// Helpers (unchanged from original)
// ---------------------------------------------------------------------------

const getUpdatedAtValue = (value?: string | Date | null) =>
  value ? new Date(value).getTime() : 0;

const isDevelopment = process.env.NODE_ENV === "development";

const devLog = (
  level: "debug" | "info" | "error",
  message?: unknown,
  ...optionalParams: unknown[]
) => {
  if (!isDevelopment) return;
  console[level](message, ...optionalParams);
};

const isServerRowNewer = <T extends IdentifiableRow>(server: T, local: T) => {
  if (typeof server.version === "number" && typeof local.version === "number") {
    return server.version > local.version;
  }

  return getUpdatedAtValue(server.updatedAt) > getUpdatedAtValue(local.updatedAt);
};

const preservePinnedRowIndex = <T extends IdentifiableRow>(
  previous: T[],
  next: T[],
  pinnedRowId?: string | null,
) => {
  if (!pinnedRowId) return next;

  const previousIndex = previous.findIndex((item) => item.id === pinnedRowId);
  const nextIndex = next.findIndex((item) => item.id === pinnedRowId);

  if (previousIndex === -1 || nextIndex === -1 || previousIndex === nextIndex) {
    return next;
  }

  const reordered = [...next];
  const [pinnedRow] = reordered.splice(nextIndex, 1);
  reordered.splice(Math.min(previousIndex, reordered.length), 0, pinnedRow);
  return reordered;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useRealtimeUpdates = <T extends IdentifiableRow>({
  entity,
  setItems,
  sortFn,
  sortOrder = "desc",
  pinnedRowId,
  matchesFilter,
  onResync,
}: UseRealtimeUpdatesOptions<T>) => {
  // Stable refs — avoid re-registering the listener on every render
  const setItemsRef = useRef(setItems);
  const matchesFilterRef = useRef(matchesFilter);
  const sortFnRef = useRef(sortFn);
  const pinnedRowIdRef = useRef(pinnedRowId);
  const sortOrderRef = useRef(sortOrder);

  useEffect(() => { setItemsRef.current = setItems; }, [setItems]);
  useEffect(() => { matchesFilterRef.current = matchesFilter; }, [matchesFilter]);
  useEffect(() => { sortFnRef.current = sortFn; }, [sortFn]);
  useEffect(() => { pinnedRowIdRef.current = pinnedRowId; }, [pinnedRowId]);
  useEffect(() => { sortOrderRef.current = sortOrder; }, [sortOrder]);

  const currentIdsRef = useRef<string[]>([]);
  const onResyncRef = useRef(onResync);
  useEffect(() => { onResyncRef.current = onResync; }, [onResync]);

  // ---------------------------------------------------------------------------
  // Full State Resync — fetch latest rows + locks after reconnect
  // ---------------------------------------------------------------------------

  const handleResync = useCallback(async () => {
    // 1. Trigger parent re-fetch if provided (e.g. refresh entire page 1)
    if (onResyncRef.current) {
      await onResyncRef.current();
    }

    // 2. Background target resync for currently visible IDs
    const ids = currentIdsRef.current;
    if (ids.length === 0) return;

    devLog(
      "info",
      `[useRealtimeUpdates:${entity}] Resyncing ${ids.length} row(s)…`,
    );

    try {
      const params = new URLSearchParams({
        entity,
        ids: ids.join(","),
        includeRows: "true",
      });

      const response = await fetch(`${ADMIN_ROW_SYNC_ENDPOINT}?${params}`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) return;

      const payload = (await response.json()) as {
        success: boolean;
        rows?: T[];
      };

      if (payload.success && payload.rows) {
        setItemsRef.current((previous) => {
          const incoming = payload.rows!;
          const incomingMap = new Map(incoming.map((r) => [r.id, r]));
          const previousIds = new Set(previous.map((r) => r.id));

          // Smart merge + stale cleanup
          const next = previous
            .map((existing) => {
              const updated = incomingMap.get(existing.id);
              if (!updated) {
                // If it was in our search, but not in sync response, it's deleted
                return null;
              }

              if (isServerRowNewer(updated, existing)) {
                return updated;
              }
              return existing;
            })
            .filter((item): item is T => item !== null);

          // Add any "new" items that appeared (though usually we only sync existing)
          for (const row of incoming) {
            if (!previousIds.has(row.id)) {
              next.push(row);
            }
          }

          const sort = sortFnRef.current;
          if (sort) {
            next.sort((a, b) => sort(a, b, sortOrderRef.current));
          }

          const result = preservePinnedRowIndex(
            previous,
            next,
            pinnedRowIdRef.current,
          );
          currentIdsRef.current = result.map((r) => r.id);
          return result;
        });
        devLog("info", `[useRealtimeUpdates:${entity}] Row resync complete.`);
      }
    } catch (error) {
      devLog("error", `[useRealtimeUpdates:${entity}] Row resync failed:`, error);
    }
  }, [entity]);

  // Shared SSE lifecycle (connect / reconnect / resync)
  useRealtimeCore({ onResync: handleResync });

  // Stable message handler — only re-registered when `entity` changes
  const handleMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as AdminRealtimeEvent<T>;

        if (parsed.kind !== "row" || parsed.channel !== entity) return;

        devLog(
          "debug",
          `[useRealtimeUpdates:${entity}] Event received:`,
          parsed.type,
          parsed.entityId,
        );

        setItemsRef.current((previous) => {
          const currentIndex = previous.findIndex(
            (item) => item.id === parsed.entityId,
          );
          const currentItem = currentIndex >= 0 ? previous[currentIndex] : null;
          let next = previous;

          if (parsed.type === "DELETE") {
            next = previous.filter((item) => item.id !== parsed.entityId);
            return preservePinnedRowIndex(previous, next, pinnedRowIdRef.current);
          }

          if (!parsed.data) return previous;

          if (currentItem && !isServerRowNewer(parsed.data, currentItem)) {
            return previous;
          }

          const filter = matchesFilterRef.current;
          if (filter && !filter(parsed.data)) {
            next = previous.filter((item) => item.id !== parsed.entityId);
          } else if (currentIndex >= 0) {
            next = previous.map((item) =>
              item.id === parsed.entityId ? parsed.data : item,
            ) as T[];
          } else {
            next = [...previous, parsed.data];
          }

          const sort = sortFnRef.current;
          if (sort) {
            next = [...next].sort((a, b) =>
              sort(a, b, sortOrderRef.current),
            );
          }

          const result = preservePinnedRowIndex(
            previous,
            next,
            pinnedRowIdRef.current,
          );
          currentIdsRef.current = result.map((r) => r.id);
          return result;
        });
      } catch (error) {
        devLog(
          "error",
          `[useRealtimeUpdates:${entity}] Failed to process event:`,
          error,
        );
      }
    },
    [entity],
  );

  // Register / un-register message listener
  useEffect(() => {
    devLog("info", `[useRealtimeUpdates:${entity}] Registering message listener.`);
    const unsub = onMessage(handleMessage);
    return () => {
      devLog(
        "info",
        `[useRealtimeUpdates:${entity}] Unregistering message listener.`,
      );
      unsub();
    };
  }, [entity, handleMessage]);
};
