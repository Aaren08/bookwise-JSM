"use client";

/**
 * useRealtimeCore — shared SSE lifecycle hook.
 *
 * Responsibilities:
 *  - Connects the singleton EventSource on mount, disconnects on last unmount.
 *  - Tracks a reference-count so the connection stays open while any consumer
 *    is mounted (BorrowTable, UserTable, AccountTable can all coexist).
 *  - Dispatches raw MessageEvents globally via the realtimeClient listener API.
 *  - Triggers a `onResync` callback after every reconnect so consumers can
 *    re-fetch their current state (locks, rows) and clear stale data.
 *  - Exposes the live connection status for optional UI indicators.
 *
 * Usage:
 *   const { status } = useRealtimeCore({ onResync });
 */

import { useEffect, useRef, useState } from "react";
import {
  connect,
  disconnect,
  onHeartbeat,
  onPeriodicResync,
  onStatus,
} from "@/lib/realtime/realtimeClient";

// ---------------------------------------------------------------------------
// Reference counting so the connection outlives individual hook instances
// ---------------------------------------------------------------------------

let mountCount = 0;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseRealtimeCoreOptions = {
  /** Called after every reconnect (status goes from reconnecting → connected). */
  onResync?: () => void | Promise<void>;
};

type RealtimeStatus = "connected" | "reconnecting" | "stale" | "disconnected";

const RESYNC_DEBOUNCE_MS = 5_000;
const isDevelopment = process.env.NODE_ENV === "development";

const devLog = (
  level: "debug" | "info",
  message?: unknown,
  ...optionalParams: unknown[]
) => {
  if (!isDevelopment) return;
  console[level](message, ...optionalParams);
};

export function useRealtimeCore({ onResync }: UseRealtimeCoreOptions = {}) {
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");

  // Track previous status to detect reconnect transitions
  const prevStatusRef = useRef<RealtimeStatus>("disconnected");
  const isResyncingRef = useRef(false);
  const lastResyncRef = useRef(0);
  // Stable ref to the latest onResync callback (avoids stale closure)
  const onResyncRef = useRef(onResync);
  useEffect(() => {
    onResyncRef.current = onResync;
  }, [onResync]);

  const safeResync = async () => {
    const now = Date.now();
    if (
      isResyncingRef.current ||
      now - lastResyncRef.current < RESYNC_DEBOUNCE_MS
    ) {
      return;
    }

    isResyncingRef.current = true;
    lastResyncRef.current = now;

    try {
      await onResyncRef.current?.();
    } finally {
      isResyncingRef.current = false;
    }
  };

  useEffect(() => {
    // --- Mount: increment ref count, open if this is the first consumer ---
    mountCount += 1;
    devLog(
      "info",
      `[useRealtimeCore] Mount (consumers: ${mountCount}). Connecting…`,
    );
    connect();

    // Status changes
    const unsubStatus = onStatus((nextStatus) => {
      setStatus(nextStatus);

      const wasReconnecting = prevStatusRef.current === "reconnecting";
      prevStatusRef.current = nextStatus;

      // Reconnect detected: previous was "reconnecting", now "connected"
      if (wasReconnecting && nextStatus === "connected") {
        devLog(
          "info",
          "[useRealtimeCore] Reconnected — triggering state resync.",
        );
        void safeResync();
      }
    });

    // Heartbeat log (backoff reset happens inside realtimeClient)
    const unsubHeartbeat = onHeartbeat(() => {
      devLog("debug", "[useRealtimeCore] Heartbeat acknowledged.");
    });

    // Periodic safety resync (every 60s)
    const unsubResync = onPeriodicResync(() => {
      devLog("info", "[useRealtimeCore] Periodic resync triggered.");
      void safeResync();
    });

    return () => {
      unsubStatus();
      unsubHeartbeat();
      unsubResync();

      // --- Unmount: decrement ref count, close only when last consumer gone ---
      mountCount -= 1;
      devLog(
        "info",
        `[useRealtimeCore] Unmount (consumers remaining: ${mountCount}).`,
      );

      if (mountCount <= 0) {
        mountCount = 0;
        disconnect();
      }
    };
  }, []); // intentionally empty — connect/disconnect are module-level singletons

  return { status };
}
