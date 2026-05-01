# Realtime Client - Singleton SSE Implementation

## Overview

`lib/realtime/realtimeClient.ts` provides a singleton Server-Sent Events (SSE) client for the admin realtime stream. It eliminates duplicate connections, inconsistent reconnect races, and high failure rates by sharing a single `EventSource` across all hooks.

## Architecture

### Key Principles

1. **Singleton Pattern**: Only one `EventSource` connection per tab/browser instance
2. **Reference Counting**: Connection stays open while any consumer is mounted
3. **Exponential Backoff**: Reconnection strategy with 100ms → 200ms → 400ms … capped at 30s
4. **Listener API**: Global broadcast system for message, heartbeat, status, and resync events
5. **Automatic Resync**: Periodic safety resync every 60s + on reconnect transition

### Module-Level State

```typescript
let eventSource: EventSource | null = null;
let retryDelay = 100; // ms – current backoff delay
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null;
let periodicResyncTimer: ReturnType<typeof setInterval> | null = null;
let isConnecting = false;
let lastHeartbeat = Date.now();
let currentStatus: "connected" | "reconnecting" | "stale" | "disconnected" =
  "disconnected";
```

This state survives across React renders but resets on hard page reload.

## Connection Lifecycle

### 1. Connection (on first mount)

When the first consumer calls `connect()`:

```typescript
export const connect = async () => {
  if (eventSource !== null) return; // already open
  if (isConnecting) return;

  isConnecting = true;
  notifyStatus("reconnecting");

  try {
    eventSource = new EventSource(ADMIN_ROW_REALTIME_ENDPOINT);
    // ... setup message/error handlers
    isConnecting = false;
    notifyStatus("connected");
    startHeartbeatCheck();
    startPeriodicResync();
  } catch (error) {
    isConnecting = false;
    scheduleReconnect();
  }
};
```

### 2. Heartbeat Monitoring

The client monitors heartbeats to detect stale connections:

- **Heartbeat Timeout**: 30 seconds
- **Check Interval**: Every 5 seconds
- **Logic**: If no heartbeat for 30s, status becomes `"stale"` and reconnection is triggered

```typescript
const startHeartbeatCheck = () => {
  heartbeatCheckTimer = setInterval(() => {
    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      notifyStatus("stale");
      disconnect();
      scheduleReconnect();
    }
  }, HEARTBEAT_CHECK_INTERVAL);
};
```

### 3. Reconnection (Exponential Backoff)

When connection is lost or times out:

```typescript
const scheduleReconnect = () => {
  if (reconnectTimer !== null) return; // already scheduled

  notifyStatus("reconnecting");

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(); // Attempt to reconnect

    // Increase backoff: min 100ms, max 30s
    retryDelay = Math.min(retryDelay * 2, 30000);
  }, retryDelay);
};
```

**Backoff resets** when the first `heartbeat` event arrives after a fresh open connection.

### 4. Periodic Resync

Every 60 seconds, a `resync` event is broadcast to all listeners:

```typescript
const startPeriodicResync = () => {
  periodicResyncTimer = setInterval(() => {
    broadcast(listeners.resync, undefined);
  }, PERIODIC_RESYNC_INTERVAL);
};
```

This allows consumers (tables, forms) to re-fetch state safely even if they missed events during a glitch.

### 5. Disconnection (on last unmount)

When the last consumer calls `disconnect()`:

```typescript
export const disconnect = () => {
  mountCount = Math.max(0, mountCount - 1);

  if (mountCount === 0) {
    closeEventSource();
  }
};

const closeEventSource = () => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  clearInterval(heartbeatCheckTimer);
  clearInterval(periodicResyncTimer);
  clearTimeout(reconnectTimer);

  notifyStatus("disconnected");
};
```

## Event Types

The client handles multiple event types through the listener API:

### 1. Message Events

Generic SSE data messages. Listeners registered via `onMessage()`:

```typescript
export const onMessage = (handler: RealtimeEventHandler) => {
  listeners.message.add(handler);

  return () => listeners.message.delete(handler);
};

// In EventSource:
eventSource.addEventListener("message", (event) => {
  broadcast(listeners.message, event);
});
```

### 2. Heartbeat Events

Named SSE events (event type: `heartbeat`). Resets the backoff timer and stale detection:

```typescript
export const onHeartbeat = (handler: RealtimeHeartbeatHandler) => {
  listeners.heartbeat.add(handler);
  return () => listeners.heartbeat.delete(handler);
};

eventSource.addEventListener("heartbeat", () => {
  lastHeartbeat = Date.now();
  retryDelay = 100; // reset backoff
  broadcast(listeners.heartbeat);
});
```

### 3. Status Events

Connection status changes. Listeners via `onStatus()`:

```typescript
export type RealtimeStatusHandler = (
  status: "connected" | "reconnecting" | "stale" | "disconnected",
) => void;

export const onStatus = (handler: RealtimeStatusHandler) => {
  listeners.status.add(handler);
  return () => listeners.status.delete(handler);
};
```

### 4. Resync Events

Periodic signal for consumers to re-fetch state. Listeners via `onPeriodicResync()`:

```typescript
export const onPeriodicResync = (handler: RealtimeResyncHandler) => {
  listeners.resync.add(handler);
  return () => listeners.resync.delete(handler);
};
```

## Reference Counting

The client uses a reference count to manage multiple consumers:

```typescript
let mountCount = 0;

export const connect = async () => {
  mountCount++;

  if (eventSource !== null) return; // already open
  // ... connect logic
};

export const disconnect = () => {
  mountCount = Math.max(0, mountCount - 1);

  if (mountCount === 0) {
    closeEventSource();
  }
};
```

This allows:

- `BorrowTable`, `UserTable`, `AccountTable` can all mount simultaneously
- Each calls `useRealtimeCore` internally (which calls `connect()`)
- Only one actual `EventSource` is created
- Connection stays open until all consumers unmount

## Error Handling

### Network Errors

```typescript
eventSource.addEventListener("error", () => {
  devLog("warn", "[RealtimeClient] EventSource error");
  disconnect();
  scheduleReconnect();
});
```

### Parse Errors in Message Listeners

Each listener is wrapped in try-catch:

```typescript
const broadcast = <T>(set: Set<(arg: T) => void>, arg: T) => {
  for (const fn of set) {
    try {
      fn(arg);
    } catch (err) {
      devLog("error", "[RealtimeClient] listener error:", err);
    }
  }
};
```

### Development Logging

A `devLog` helper provides debug output only in development:

```typescript
const devLog = (
  level: "debug" | "info" | "warn" | "error",
  message?: unknown,
  ...optionalParams: unknown[]
) => {
  if (!isDevelopment) return;
  console[level](message, ...optionalParams);
};
```

## Usage Pattern

### From a Hook

```typescript
import {
  connect,
  disconnect,
  onMessage,
  onStatus,
} from "@/lib/realtime/realtimeClient";
import { useEffect } from "react";

export function useMyRealtime() {
  useEffect(() => {
    connect();

    const unsubscribeMessage = onMessage((event) => {
      console.log("Got message:", event);
    });

    const unsubscribeStatus = onStatus((status) => {
      console.log("Status:", status);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeStatus();
      disconnect();
    };
  }, []);
}
```

### Via useRealtimeCore

Most code uses `useRealtimeCore` from `useRealtimeCore.ts`, which wraps this:

```typescript
import { useRealtimeCore } from "@/lib/admin/realtime/concurrency/useRealtimeCore";

export function MyComponent() {
  const { status } = useRealtimeCore({
    onResync: async () => {
      // Re-fetch state after reconnect
    },
  });

  return <div>Status: {status}</div>;
}
```

## Connection State Machine

```
disconnected
    ↓ (first connect())
reconnecting
    ↓ (EventSource opens)
connected ←---(heartbeat)------+
    ↓                          |
  [30s timeout]               |
    ↓                          |
stale                        [resets backoff]
    ↓                          |
reconnecting                   |
    ↓                          |
    └────(EventSource opens)───┘
```

## Configuration

These constants control behavior:

```typescript
const HEARTBEAT_TIMEOUT = 30000; // ms – max time without heartbeat
const HEARTBEAT_CHECK_INTERVAL = 5000; // ms – how often to check
const PERIODIC_RESYNC_INTERVAL = 60000; // ms – safety resync every 60s
```

## Troubleshooting

### Connection never establishes

- Check that `/api/admin/realtime/rows` endpoint is reachable
- Verify authentication (session is valid)
- Check browser console for CORS errors

### Frequent reconnects

- Check network stability
- Monitor heartbeat timing – if server is taking >30s to send heartbeats, increase `HEARTBEAT_TIMEOUT`
- Look for proxy/load-balancer timeouts on the server

### Missing events after reconnect

- The client broadcasts a `resync` event to all listeners on periodic safety intervals (60s) and on heartbeat-triggered reconnection
- Consumers should re-fetch state in their `onResync` handler

### Memory leaks

- Always unsubscribe from listeners when unmounting:
  ```typescript
  const unsubscribe = onMessage(handler);
  // later:
  unsubscribe();
  ```
- The reference counter ensures the connection closes only when all consumers disconnect

## Development vs. Production

- Development: `devLog()` outputs detailed connection lifecycle to console
- Production: Silent operation, errors logged only to error reporters

## Related Files

- [lib/admin/realtime/concurrency/useRealtimeCore.ts](../lib/admin/realtime/concurrency/useRealtimeCore.ts) – Hook wrapper with reference counting and resync debouncing
- [lib/admin/realtime/concurrency/useRowLock.ts](../lib/admin/realtime/concurrency/useRowLock.ts) – Lock management using this client
- [lib/admin/realtime/concurrency/useRealtimeUpdates.ts](../lib/admin/realtime/concurrency/useRealtimeUpdates.ts) – Row-level updates using this client
- [app/api/admin/realtime/rows/route.ts](../app/api/admin/realtime/rows/route.ts) – Server-side SSE endpoint
