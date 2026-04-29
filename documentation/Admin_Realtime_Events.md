# Admin Realtime Events System

## Overview

The admin realtime events system provides a standardized event format for Server-Sent Events (SSE) that coordinate admin dashboard updates across row locks, data mutations, and connection lifecycle.

## Event Types

### 1. Row Events (`AdminRealtimeRowEvent`)

Fired when a row is created, updated, or deleted.

```typescript
type AdminRealtimeRowEvent<TData = unknown> = {
  kind: "row";
  channel: AdminRealtimeEntity; // "borrow_requests" | "account_requests" | "books" | "users"
  type: "CREATE" | "UPDATE" | "DELETE";
  entityId: string;
  data: TData | null;
  publishedAt: string; // ISO timestamp
};
```

**Example: Book Updated**

```json
{
  "kind": "row",
  "channel": "books",
  "type": "UPDATE",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Updated Book Title",
    "author": "Author Name",
    "genre": "Fiction",
    "totalCopies": 5,
    "borrowedCount": 2,
    "reservedCount": 1,
    "availableCopies": 2,
    "version": 2,
    "updatedAt": "2026-04-29T10:00:00Z"
  },
  "publishedAt": "2026-04-29T10:00:00Z"
}
```

### 2. Lock Events (`AdminRealtimeLockEvent`)

Fired when a row lock is acquired or released.

```typescript
type AdminRealtimeLockEvent = {
  kind: "lock";
  channel: "locks";
  type: "LOCK_ACQUIRED" | "LOCK_RELEASED";
  entity: AdminRealtimeEntity;
  entityId: string;
  id: string;
  adminName?: string; // name of admin who holds/held lock
  lock: AdminRowLock | null; // null when released
  publishedAt: string;
};

type AdminRowLock = {
  entity: AdminRealtimeEntity;
  entityId: string;
  adminId: string;
  adminName: string;
  expiresAt: string;
  token: string;
};
```

**Example: Lock Acquired**

```json
{
  "kind": "lock",
  "channel": "locks",
  "type": "LOCK_ACQUIRED",
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "adminName": "Jane Admin",
  "lock": {
    "entity": "books",
    "entityId": "550e8400-e29b-41d4-a716-446655440000",
    "adminId": "admin-456",
    "adminName": "Jane Admin",
    "expiresAt": "2026-04-29T10:20:00Z",
    "token": "a1b2c3d4e5f6"
  },
  "publishedAt": "2026-04-29T10:00:00Z"
}
```

**Example: Lock Released**

```json
{
  "kind": "lock",
  "channel": "locks",
  "type": "LOCK_RELEASED",
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "adminName": null,
  "lock": null,
  "publishedAt": "2026-04-29T10:00:00Z"
}
```

### 3. Heartbeat Events (`AdminRealtimeHeartbeatEvent`)

Sent periodically to detect stale connections and reset exponential backoff.

```typescript
type AdminRealtimeHeartbeatEvent = {
  kind: "heartbeat";
  timestamp: string; // ISO timestamp
};
```

**Example**

```json
{
  "kind": "heartbeat",
  "timestamp": "2026-04-29T10:00:00Z"
}
```

### Union Type

```typescript
type AdminRealtimeEvent<TData = unknown> =
  | AdminRealtimeRowEvent<TData>
  | AdminRealtimeLockEvent
  | AdminRealtimeHeartbeatEvent;
```

## Channels

### ADMIN_ROW_REALTIME_CHANNELS

Four channels correspond to admin table entities:

```typescript
export const ADMIN_ROW_REALTIME_CHANNELS = [
  "borrow_requests", // borrow_records table with relationships
  "account_requests", // pending users
  "books", // books table
  "users", // approved users
] as const;

export type AdminRealtimeEntity = (typeof ADMIN_ROW_REALTIME_CHANNELS)[number];
```

When `/api/admin/realtime/rows` is opened, the server subscribes to all four channels plus the locks channel.

### ADMIN_ROW_LOCKS_CHANNEL

```typescript
export const ADMIN_ROW_LOCKS_CHANNEL = "locks";
```

All lock acquisition/release events are published here (regardless of entity type).

## Configuration Constants

```typescript
export const ADMIN_ROW_REALTIME_ENDPOINT = "/api/admin/realtime/rows";
export const ADMIN_ROW_SYNC_ENDPOINT = "/api/admin/sync";

export const ADMIN_ROW_REALTIME_RETRY_MS = 2000; // SSE reconnect delay
export const ADMIN_ROW_REALTIME_KEEPALIVE_MS = 25000; // max time without message
export const ADMIN_ROW_REALTIME_HEARTBEAT_MS = 15000; // heartbeat interval
```

## Type Guards

### isAdminRealtimeEvent

Top-level type guard for all event types:

```typescript
export const isAdminRealtimeEvent = (
  value: unknown,
): value is AdminRealtimeEvent => {
  if (!isRecord(value)) return false;

  if (value.kind === "heartbeat") {
    return isAdminRealtimeHeartbeatEvent(value);
  }

  if (value.kind === "row") {
    return (
      typeof value.channel === "string" &&
      typeof value.type === "string" &&
      typeof value.entityId === "string" &&
      typeof value.publishedAt === "string" &&
      ("data" in value || value.data === null)
    );
  }

  if (value.kind === "lock") {
    return (
      value.channel === ADMIN_ROW_LOCKS_CHANNEL &&
      typeof value.type === "string" &&
      typeof value.entity === "string" &&
      typeof value.entityId === "string" &&
      typeof value.id === "string" &&
      typeof value.publishedAt === "string" &&
      (value.lock === null || isAdminRowLock(value.lock))
    );
  }

  return false;
};
```

### Other Specific Guards

```typescript
export const isAdminRowLock = (value: unknown): value is AdminRowLock => { ... }

export const isAdminRealtimeHeartbeatEvent = (
  value: unknown,
): value is AdminRealtimeHeartbeatEvent => { ... }
```

## SSE Encoding

### Standard Row/Lock Events

```typescript
export const encodeAdminRealtimeEvent = (message: AdminRealtimeEvent) =>
  `data: ${JSON.stringify(message)}\n\n`;
```

Produces a generic SSE message:

```
data: {"kind":"row","channel":"books",...}\n\n
```

Clients receive this via the generic `message` event handler.

### Named Heartbeat Events

```typescript
export const encodeHeartbeatEvent = (): string =>
  `event: heartbeat\ndata: ${JSON.stringify({ kind: "heartbeat", timestamp: new Date().toISOString() })}\n\n`;
```

Produces a named SSE event:

```
event: heartbeat
data: {"kind":"heartbeat","timestamp":"2026-04-29T10:00:00Z"}\n\n
```

Clients receive this via `addEventListener("heartbeat", ...)`.

**Why named events for heartbeat?**

- Some proxies/load-balancers treat SSE comments (`:heartbeat\n`) as body content and reset their body-read timeout
- Named events are recognized as proper SSE events and don't trigger timeouts
- Clients can detect stale connections by checking time since last named event

## Event Flow

### Publishing Row Events

1. Admin saves changes to a book
2. Server action completes database transaction
3. Server publishes event to Redis:
   ```typescript
   await publishEvent("books", {
     type: "UPDATE",
     entityId: bookId,
     data: updatedBook,
   });
   ```
4. Event is pushed to Redis channel `books`
5. `/api/admin/realtime/rows` subscribers receive it
6. All connected admins get SSE message
7. Hooks (`useRealtimeUpdates`) apply optimistic updates to tables

### Publishing Lock Events

1. Admin opens edit form for a book
2. Client acquires lock via `POST /api/admin/locks`
3. Server publishes `LOCK_ACQUIRED` event to Redis channel `locks`
4. All connected admins receive SSE message
5. Hooks (`useRowLock`) update UI to show "Jane Admin" editing
6. Other admins see lock indicator and cannot edit the same row

### Heartbeat Cycle

1. Client opens SSE connection to `/api/admin/realtime/rows`
2. Server sends immediate heartbeat
3. Server sends heartbeat every 15 seconds
4. Client detects stale connection if >30s without heartbeat
5. Client automatically reconnects with exponential backoff

## Data Sync Pattern

After reconnect (or periodic 60s safety resync), clients:

1. Call `GET /api/admin/sync?entity=books&ids=id1,id2,...&includeRows=true`
2. Server returns:
   ```json
   {
     "success": true,
     "locks": {
       "id1": { ... lock info ... },
       "id2": null
     },
     "rows": [
       { id: "id1", title: "...", version: 2, ... },
       { id: "id2", title: "...", version: 1, ... }
     ]
   }
   ```
3. Client re-hydrates:
   - Lock state from `locks`
   - Row data from `rows`
   - Clears any stale local changes not yet persisted

## Conflict Detection

When a client receives a row update event, it compares versions:

```typescript
const isServerRowNewer = <T extends IdentifiableRow>(
  server: T,
  local: T,
): boolean => {
  if (typeof server.version === "number" && typeof local.version === "number") {
    return server.version > local.version;
  }

  return (
    new Date(server.updatedAt).getTime() > new Date(local.updatedAt).getTime()
  );
};
```

**Conflict Resolution**:

- If server version is newer, apply server version
- If server data has a different shape, apply server data
- If local row is pinned (being edited by current admin), keep local but flag as stale
- Clients request full sync on reconnect to ensure consistency

## Troubleshooting

### Events are not arriving

Check:

1. SSE endpoint `/api/admin/realtime/rows` is returning `200` with `Content-Type: text/event-stream`
2. Admin is authenticated and has `role: "ADMIN"`
3. Browser DevTools → Network tab shows active connection to the endpoint
4. Redis is running and reachable
5. Events are being published to the correct channel names

### Heartbeat timeouts

Check:

1. Network latency – heartbeats should arrive every ~15s
2. Proxy/load-balancer settings – some may have default 30s keep-alive timeouts
3. Client `HEARTBEAT_TIMEOUT` (30s) may be too aggressive
4. Server `ADMIN_ROW_REALTIME_HEARTBEAT_MS` (15s) may be too infrequent

### Stale lock indicators

Check:

1. Client-side TTL sweep runs every 10s – expired locks are removed
2. Manually refresh page to force sync: `GET /api/admin/sync`
3. Check Redis TTL: `redis-cli TTL lock:books:id1` (should be <60s)
4. If 0 or -1, lock has expired – wait for client sweep or refresh

### Version conflicts during save

Check:

1. Another admin may have updated the row since you loaded it
2. Your local version number should match database before save
3. Refresh form and try again (sync endpoint will re-hydrate correct version)
4. Check `version` field in server sync response

## Related Files

- [lib/admin/realtime/concurrency/rowConcurrency.ts](../lib/admin/realtime/concurrency/rowConcurrency.ts) – Event publishing
- [lib/admin/realtime/concurrency/useRowLock.ts](../lib/admin/realtime/concurrency/useRowLock.ts) – Lock event handling
- [lib/admin/realtime/concurrency/useRealtimeUpdates.ts](../lib/admin/realtime/concurrency/useRealtimeUpdates.ts) – Row event handling
- [app/api/admin/realtime/rows/route.ts](../app/api/admin/realtime/rows/route.ts) – SSE stream endpoint
- [app/api/admin/sync/route.ts](../app/api/admin/sync/route.ts) – Sync/re-hydrate endpoint
- [lib/realtime/realtimeClient.ts](../lib/realtime/realtimeClient.ts) – SSE connection lifecycle
