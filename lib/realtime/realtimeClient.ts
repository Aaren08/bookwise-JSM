"use client";

/**
 * Singleton SSE client for the admin realtime stream.
 *
 * A single EventSource is shared across all hooks (`useRealtimeCore`,
 * `useRowLock`, `useRealtimeUpdates`). This eliminates:
 *   - duplicate connections per page
 *   - inconsistent reconnect races
 *   - higher failure rates from multiple open streams
 *
 * Reconnect strategy: exponential backoff (100 ms → 200 → 400 … capped at 30 s).
 * Backoff resets to 100 ms on the first `heartbeat` event after a fresh open.
 */

import { ADMIN_ROW_REALTIME_ENDPOINT } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RealtimeEventHandler = (event: MessageEvent) => void;
export type RealtimeHeartbeatHandler = () => void;
export type RealtimeStatusHandler = (
  status: "connected" | "reconnecting" | "stale" | "disconnected",
) => void;
export type RealtimeResyncHandler = () => void;

type ListenerSet = {
  message: Set<RealtimeEventHandler>;
  heartbeat: Set<RealtimeHeartbeatHandler>;
  status: Set<RealtimeStatusHandler>;
  resync: Set<RealtimeResyncHandler>;
};

const HEARTBEAT_TIMEOUT = 30000;
const HEARTBEAT_CHECK_INTERVAL = 5000;
const PERIODIC_RESYNC_INTERVAL = 60000;

// ---------------------------------------------------------------------------
// Module-level state (survives across React renders, resets on hard reload)
// ---------------------------------------------------------------------------

let eventSource: EventSource | null = null;
let retryDelay = 100; // ms – current backoff delay
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null;
let periodicResyncTimer: ReturnType<typeof setInterval> | null = null;
let isConnecting = false;
let lastHeartbeat = Date.now();
let currentStatus: "connected" | "reconnecting" | "stale" | "disconnected" =
  "disconnected";
const isDevelopment = process.env.NODE_ENV === "development";

const listeners: ListenerSet = {
  message: new Set(),
  heartbeat: new Set(),
  status: new Set(),
  resync: new Set(),
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const devLog = (
  level: "debug" | "info" | "warn" | "error",
  message?: unknown,
  ...optionalParams: unknown[]
) => {
  if (!isDevelopment) return;
  console[level](message, ...optionalParams);
};

const broadcast = <T>(set: Set<(arg: T) => void>, arg: T) => {
  for (const fn of set) {
    try {
      fn(arg);
    } catch (err) {
      devLog("error", "[RealtimeClient] listener error:", err);
    }
  }
};

const notifyStatus = (
  status: "connected" | "reconnecting" | "stale" | "disconnected",
) => {
  currentStatus = status;
  broadcast(listeners.status, status);
};

const scheduleReconnect = () => {
  if (reconnectTimer !== null) return; // already scheduled

  notifyStatus("reconnecting");
  devLog(
    "warn",
    `[RealtimeClient] Reconnecting in ${retryDelay} ms (backoff)…`,
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    retryDelay = Math.min(retryDelay * 2, 30_000);
    connect();
  }, retryDelay);
};

const handleActivity = () => {
  retryDelay = 100;
  lastHeartbeat = Date.now();
};

const startInternalLoops = () => {
  if (!heartbeatCheckTimer) {
    heartbeatCheckTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeat > HEARTBEAT_TIMEOUT && eventSource) {
        devLog("warn", "[RealtimeClient] Heartbeat timeout — forcing reconnect");
        notifyStatus("stale");
        eventSource.close();
        eventSource = null;
        scheduleReconnect();
      }
    }, HEARTBEAT_CHECK_INTERVAL);
  }

  if (!periodicResyncTimer) {
    periodicResyncTimer = setInterval(() => {
      if (eventSource?.readyState === EventSource.OPEN) {
        devLog("debug", "[RealtimeClient] Triggering periodic safety resync.");
        broadcast(listeners.resync, undefined as unknown as void);
      }
    }, PERIODIC_RESYNC_INTERVAL);
  }
};

const stopInternalLoops = () => {
  if (heartbeatCheckTimer) {
    clearInterval(heartbeatCheckTimer);
    heartbeatCheckTimer = null;
  }
  if (periodicResyncTimer) {
    clearInterval(periodicResyncTimer);
    periodicResyncTimer = null;
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open (or re-use) the singleton EventSource.
 * Safe to call multiple times: a no-op when already connected.
 */
export function connect() {
  if (isConnecting || eventSource?.readyState === EventSource.OPEN) return;

  isConnecting = true;
  devLog("info", "[RealtimeClient] Opening SSE connection…");

  const es = new EventSource(ADMIN_ROW_REALTIME_ENDPOINT, {
    withCredentials: true,
  });

  es.onopen = () => {
    isConnecting = false;
    handleActivity();
    devLog("info", "[RealtimeClient] SSE connection opened.");
    notifyStatus("connected");
    startInternalLoops();
  };

  /** All non-heartbeat messages → forward to registered handlers */
  es.onmessage = (event) => {
    handleActivity();
    broadcast(listeners.message, event);
  };

  /**
   * Named `event: heartbeat` frame.
   * This is what the server sends every 15 s (not a comment).
   * Receiving it means:
   *   1. The stream is alive.
   *   2. We can safely reset the backoff delay.
   */
  es.addEventListener("heartbeat", () => {
    handleActivity();
    devLog("debug", "[RealtimeClient] Heartbeat received.");
    broadcast(listeners.heartbeat, undefined as unknown as void);
  });

  es.onerror = () => {
    isConnecting = false;
    devLog("error", "[RealtimeClient] SSE error / disconnect detected.");

    // Close the broken source before opening a new one
    es.close();
    if (eventSource === es) eventSource = null;

    scheduleReconnect();
  };

  eventSource = es;
}

/**
 * Forcefully close and nullify the singleton.
 * Called when the last consumer unmounts or during explicit teardown.
 */
export function disconnect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  stopInternalLoops();
  isConnecting = false;
  notifyStatus("disconnected");
  devLog("info", "[RealtimeClient] SSE connection closed.");
}

/** Current connection state */
export function getReadyState(): number {
  return eventSource?.readyState ?? EventSource.CLOSED;
}

export function getStatus() {
  return currentStatus;
}

// ---------------------------------------------------------------------------
// Listener registration
// ---------------------------------------------------------------------------

/** Subscribe to `message` (non-heartbeat) events. Returns an unsubscribe fn. */
export function onMessage(handler: RealtimeEventHandler): () => void {
  listeners.message.add(handler);
  return () => listeners.message.delete(handler);
}

/** Subscribe to `heartbeat` events. Returns an unsubscribe fn. */
export function onHeartbeat(handler: RealtimeHeartbeatHandler): () => void {
  listeners.heartbeat.add(handler);
  return () => listeners.heartbeat.delete(handler);
}

/** Subscribe to connection-status changes. Returns an unsubscribe fn. */
export function onStatus(handler: RealtimeStatusHandler): () => void {
  listeners.status.add(handler);
  return () => listeners.status.delete(handler);
}

/** Subscribe to periodic resync triggers (every 60s). Returns an unsubscribe fn. */
export function onPeriodicResync(handler: RealtimeResyncHandler): () => void {
  listeners.resync.add(handler);
  return () => listeners.resync.delete(handler);
}
