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
  id: string;            // same as entityId — the locked row's ID
  adminName?: string;    // name of admin who holds/held the lock
  lock: AdminRowLock | null; // null when released
  publishedAt: string;
};
```

**`AdminRowLock` shape** (as of current schema):

```typescript
type AdminRowLock = {
  entity: AdminRealtimeEntity;
  entityId: string;
  adminId: string;
  adminName: string;
  expiresAt: string;  // ISO timestamp
  token: string;      // secret token for heartbeat/release verification
  version: number;    // incremented on every heartbeat; starts at 1
};
```

> **Important**: `version` on `AdminRowLock` is the lock's own heartbeat counter, not the row's data version. It allows clients and type guards to distinguish real locks from stale or corrupt Redis values.

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
    "token": "a1b2c3d4e5f6",
    "version": 1
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
  "adminName": "Jane Admin",
  "lock": null,
  "publishedAt": "2026-04-29T10:01:00Z"
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
  "books",           // books table
  "users",           // approved users
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

export const ADMIN_ROW_REALTIME_RETRY_MS = 2000;    // SSE reconnect delay
export const ADMIN_ROW_REALTIME_KEEPALIVE_MS = 25000; // max time without message
export const ADMIN_ROW_REALTIME_HEARTBEAT_MS = 15000; // heartbeat interval
```

## Type Guards

### isAdminRowLock

Validates the full `AdminRowLock` shape, **including `version`**:

```typescript
export const isAdminRowLock = (value: unknown): value is AdminRowLock => {
  if (!isRecord(value)) return false;

  return (
    typeof value.entity === "string" &&
    typeof value.entityId === "string" &&
    typeof value.adminId === "string" &&
    typeof value.adminName === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.token === "string" &&
    typeof value.version === "number"   // required — rejects old lock shapes
  );
};
```

> A lock without `version` (e.g., from an older Redis entry) will fail this guard and be treated as `null`.

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

### isAdminRealtimeHeartbeatEvent

```typescript
export const isAdminRealtimeHeartbeatEvent = (
  value: unknown,
): value is AdminRealtimeHeartbeatEvent =>
  isRecord(value) &&
  value.kind === "heartbeat" &&
  typeof value.timestamp === "string";
```

## SSE Encoding

### Standard Row/Lock Events

```typescript
export const encodeAdminRealtimeEvent = (message: AdminRealtimeEvent) =>
  `data: ${JSON.stringify(message)}\n\n`;
```

Produces a generic SSE message (client receives via `EventSource.onmessage`):

```
data: {"kind":"row","channel":"books",...}\n\n
```

### Named Heartbeat Events

```typescript
export const encodeHeartbeatEvent = (): string =>
  `event: heartbeat\ndata: ${JSON.stringify({ kind: "heartbeat", timestamp: new Date().toISOString() })}\n\n`;
```

Produces a named SSE event (client receives via `addEventListener("heartbeat", ...)`):

```
event: heartbeat
data: {"kind":"heartbeat","timestamp":"2026-04-29T10:00:00Z"}\n\n
```

**Why named events for heartbeat?**

- Some proxies/load-balancers treat SSE comments (`:keepalive\n`) as body content and reset their body-read timeout
- Named events are recognized as proper SSE frames and don't trigger timeouts
- Clients can detect stale connections by checking time since last named event
- On heartbeat receipt, the singleton realtimeClient resets exponential backoff to `100ms`

## Event Flow

### Publishing Row Events

1. Admin saves changes (e.g., approves a borrow request)
2. Server action completes database transaction
3. Server calls `publishEvent(channel, { type, entityId, data })`
4. Event is pushed to the Redis channel (e.g., `"borrow_requests"`)
5. `/api/admin/realtime/rows` SSE streams deliver it to all connected admins
6. `useRealtimeUpdates` hook applies version-aware merge to local table state

### Publishing Lock Events

1. Admin opens an edit form for a row
2. Client calls `POST /api/admin/locks` → server calls `acquireLock()`
3. `acquireLock` publishes `LOCK_ACQUIRED` to Redis channel `"locks"`
4. All connected admins receive the SSE lock event
5. `useRowLock` hook updates `locks[entityId]` state
6. `RowLockIndicator` renders "Jane Admin is editing" for other admins

### Heartbeat Cycle

1. Client opens SSE connection to `/api/admin/realtime/rows`
2. Server immediately sends one heartbeat frame
3. Server sends a heartbeat every 15 seconds thereafter
4. Client (`realtimeClient.ts`) tracks `lastHeartbeat = Date.now()`
5. Every 5 seconds: if `Date.now() - lastHeartbeat > 30s`, status → `"stale"` and reconnect is triggered
6. On reconnect, backoff resets to 100ms after first heartbeat

## Data Sync Pattern

After reconnect (or periodic 60s safety resync), clients:

1. Call `GET /api/admin/sync?entity=books&ids=id1,id2,...&includeRows=true`
2. Server returns combined lock + row data:
   ```json
   {
     "success": true,
     "entity": "books",
     "locks": {
       "id1": { "entity": "books", "entityId": "id1", "adminId": "...", "adminName": "Jane", "expiresAt": "...", "token": "...", "version": 3 },
       "id2": null
     },
     "rows": [
       { "id": "id1", "title": "...", "version": 2, "updatedAt": "..." },
       { "id": "id2", "title": "...", "version": 1, "updatedAt": "..." }
     ],
     "syncedAt": "2026-04-29T10:00:00Z"
   }
   ```
3. Client re-hydrates:
   - Lock state from `locks` (checked against active token to detect stolen locks)
   - Row data via smart merge (server version wins if newer, local version wins if being edited)

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

- If server `version` is higher → apply server data
- If local `version` is equal or higher → keep local (row is being edited by current admin)
- On reconnect resync: same logic applies — pinned (actively-edited) rows keep their local state

## Troubleshooting

### Events are not arriving

Check:

1. SSE endpoint `/api/admin/realtime/rows` returns `200` with `Content-Type: text/event-stream`
2. Admin is authenticated and has `role: "ADMIN"`
3. Browser DevTools → Network tab shows an active SSE connection
4. Redis is running and reachable
5. Events are being published to the correct channel names

### Lock events not reflected in UI

Check:

1. The `isAdminRowLock` type guard — if an existing Redis lock is missing the `version` field, it will be treated as `null`. Clear stale locks with `redis-cli DEL lock:entity:id`.
2. The `parsed.entity` in the lock event matches the hook's `entity` parameter — locks for `"books"` are only handled by hooks with `entity: "books"`.

### Heartbeat timeouts

Check:

1. Proxies/load-balancers — some drop idle connections before 30s; ensure `X-Accel-Buffering: no` is set
2. Server `ADMIN_ROW_REALTIME_HEARTBEAT_MS` (15s) relative to client timeout (30s) — there is a 2x safety margin

### Version conflicts during save

Check:

1. Another admin updated the same row since you loaded it
2. Your local `version` must match the database `version` column before save
3. Refresh the form and try again; the sync endpoint will re-hydrate the correct version

## Related Files

- [lib/admin/realtime/concurrency/adminRealtimeEvents.ts](../lib/admin/realtime/concurrency/adminRealtimeEvents.ts) – Event types, constants, encoders, type guards
- [lib/admin/realtime/concurrency/rowConcurrency.ts](../lib/admin/realtime/concurrency/rowConcurrency.ts) – Event publishing and lock management
- [lib/admin/realtime/concurrency/useRowLock.ts](../lib/admin/realtime/concurrency/useRowLock.ts) – Lock event handling hook
- [lib/admin/realtime/concurrency/useRealtimeUpdates.ts](../lib/admin/realtime/concurrency/useRealtimeUpdates.ts) – Row event handling hook
- [app/api/admin/realtime/rows/route.ts](../app/api/admin/realtime/rows/route.ts) – SSE stream endpoint
- [app/api/admin/sync/route.ts](../app/api/admin/sync/route.ts) – Sync/re-hydrate endpoint
