# Admin Realtime API Routes

## Overview

Three API routes coordinate the admin realtime system:

1. **`GET /api/admin/realtime/rows`** – Server-Sent Events stream for all admin events
2. **`GET /api/admin/sync`** – Sync/re-hydrate locks and rows after reconnect
3. **`GET|POST|PATCH|DELETE /api/admin/locks`** – Acquire, heartbeat, and release row locks

## Endpoint: GET /api/admin/realtime/rows

Opens an authenticated Server-Sent Events stream for admin dashboard events.

### Authentication

- Requires valid NextAuth session
- Must have `session.user.role === "ADMIN"`
- Returns `401 Unauthorized` if not authenticated

### Response Headers

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` prevents Nginx / Vercel edge from buffering the stream.

### Event Stream Format

#### 1. SSE Metadata (on connection)

```
retry: 2000

```

Tells the client to reconnect after 2 seconds if the connection drops.

#### 2. Immediate Heartbeat

```
event: heartbeat
data: {"kind":"heartbeat","timestamp":"2026-04-29T10:00:00Z"}

```

Sent immediately on connection so the client knows it's live.

#### 3. Periodic Heartbeats (every 15s)

```
event: heartbeat
data: {"kind":"heartbeat","timestamp":"2026-04-29T10:00:15Z"}

```

Allows client to detect stale connections and resets exponential backoff.

#### 4. Row Events

```
data: {"kind":"row","channel":"books","type":"UPDATE","entityId":"550e8400...","data":{...},"publishedAt":"2026-04-29T10:00:30Z"}

```

Fired when rows are created, updated, or deleted.

#### 5. Lock Events

```
data: {"kind":"lock","channel":"locks","type":"LOCK_ACQUIRED","entity":"books","entityId":"550e8400...","lock":{...},"publishedAt":"2026-04-29T10:00:30Z"}

```

Fired when locks are acquired or released.

### Channels Subscribed

```typescript
const CHANNELS = [
  "borrow_requests",
  "account_requests",
  "books",
  "users",
  "locks",
];
```

### Client Reconnection

When the client detects a closed connection:

1. Wait 2000ms (the `retry:` value)
2. Attempt to reconnect
3. Use exponential backoff if reconnects fail (100ms → 200ms → 400ms … max 30s)
4. Backoff resets when first heartbeat arrives after reconnect

---

## Endpoint: GET /api/admin/sync

Fetch current locks and optionally row data for the given entity and IDs.

### Purpose

Called by clients:

1. After every SSE reconnect (to re-hydrate state)
2. Periodically every 60 seconds (safety resync)
3. When user clicks "Refresh Table"

### Query Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `entity` | Yes | One of `borrow_requests`, `account_requests`, `books`, `users` |
| `ids` | No | Comma-separated row IDs. If omitted, returns first-page data (20 rows) |
| `includeRows` | No | When `"true"`, response also includes `rows[]` |

### Request Example

```
GET /api/admin/sync?entity=books&ids=550e8400...,550e8401...&includeRows=true
```

### Response Example

```json
{
  "success": true,
  "entity": "books",
  "locks": {
    "550e8400-e29b-41d4-a716-446655440000": {
      "entity": "books",
      "entityId": "550e8400-e29b-41d4-a716-446655440000",
      "adminId": "admin-456",
      "adminName": "Jane Admin",
      "expiresAt": "2026-04-29T10:20:00Z",
      "token": "a1b2c3...",
      "version": 3
    },
    "550e8400-e29b-41d4-a716-446655440001": null
  },
  "rows": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Book Title",
      "author": "Author Name",
      "genre": "Fiction",
      "totalCopies": 5,
      "borrowedCount": 2,
      "reservedCount": 1,
      "availableCopies": 2,
      "version": 2,
      "updatedAt": "2026-04-29T10:00:00Z"
    }
  ],
  "syncedAt": "2026-04-29T10:00:00Z"
}
```

### Fetch Logic

When `ids` is empty, fetches first page (20 rows) per entity:

```typescript
const fetchEntityRows = async (
  entity: AdminRealtimeEntity,
  ids: string[],
): Promise<unknown[]> => {
  switch (entity) {
    case "borrow_requests":
      return getBorrowRecordsForSync(ids.length > 0 ? ids : undefined);
    case "account_requests":
      return getPendingUsersForSync(ids.length > 0 ? ids : undefined);
    case "users":
      return getApprovedUsersForSync(ids.length > 0 ? ids : undefined);
    case "books":
      return getBooksForSync(ids.length > 0 ? ids : undefined);
    default:
      return [];
  }
};
```

### Error Responses

```json
// 400 Bad Request
{ "message": "Invalid entity" }

// 401 Unauthorized
{ "message": "Unauthorized" }
```

---

## Endpoint: GET /api/admin/locks

Fetch current locks for specified row IDs.

### Query Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `entity` | Yes | One of `borrow_requests`, `account_requests`, `books`, `users` |
| `ids` | No | Comma-separated row IDs |

### Response

```json
{
  "success": true,
  "locks": {
    "550e8400-e29b-41d4-a716-446655440000": {
      "entity": "books",
      "entityId": "550e8400-e29b-41d4-a716-446655440000",
      "adminId": "admin-456",
      "adminName": "Jane Admin",
      "expiresAt": "2026-04-29T10:20:00Z",
      "token": "a1b2c3...",
      "version": 3
    },
    "550e8400-e29b-41d4-a716-446655440001": null
  }
}
```

---

## Endpoint: POST /api/admin/locks

Acquire a row lock.

### Request Body

```json
{
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000"
}
```

`token` is not needed on first acquire; the server generates one.

### Response on Success (`200`)

```json
{
  "success": true,
  "lock": {
    "entity": "books",
    "entityId": "550e8400-e29b-41d4-a716-446655440000",
    "adminId": "admin-456",
    "adminName": "Jane Admin",
    "expiresAt": "2026-04-29T10:20:00Z",
    "token": "a1b2c3...",
    "version": 1
  }
}
```

### Response on Lock Held by Another Admin (`409`)

```json
{
  "success": false,
  "message": "Row locked by John Admin",
  "lock": {
    "entity": "books",
    "entityId": "550e8400-e29b-41d4-a716-446655440000",
    "adminId": "admin-789",
    "adminName": "John Admin",
    "expiresAt": "2026-04-29T10:15:00Z",
    "token": "xyz...",
    "version": 2
  }
}
```

### Behavior

- If no lock exists → acquires it, returns `success: true` with the new lock
- If current admin already holds the lock → re-entrant acquire: refreshes TTL, bumps lock `version`, keeps same token
- If another admin holds the lock → returns `409` with that admin's lock info
- On success: broadcasts `LOCK_ACQUIRED` event to all admins

---

## Endpoint: PATCH /api/admin/locks

Heartbeat-only lock refresh. Extends the Redis TTL without changing the token.

> **Note**: PATCH is exclusively for heartbeats. It is not an alias for POST. Unlike POST which creates or re-acquires, PATCH only refreshes an existing lock that the current admin already owns.

### Request Body

```json
{
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "a1b2c3..."
}
```

`token` is **required** — returns `400` if missing.

### Response on Success (`200`)

```json
{ "success": true }
```

### Response on Failure (`409`)

```json
{ "success": false, "message": "Lock not owned or expired" }
```

**Failure causes**: Lock expired, `adminId` doesn't match, or `token` doesn't match.

---

## Endpoint: DELETE /api/admin/locks

Release a row lock.

### Request Body

```json
{
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "a1b2c3..."
}
```

Both `entity`/`entityId` and `token` are **required**. Returns `400` if `token` is missing.

### Response on Success (`200`)

```json
{
  "success": true,
  "reason": "released",
  "message": "Lock released"
}
```

### Response on Non-ownership (`200`, `success: false`)

```json
{
  "success": false,
  "reason": "wrong_owner",
  "message": "Lock not owned by current admin"
}
```

> **Breaking change from older versions**: The response no longer includes a `lock` field. The outcome is communicated through `success` (boolean) and `reason` (string). See `reason` codes below.

### `reason` Codes

| Reason | Meaning |
|--------|---------|
| `"released"` | Lock deleted successfully |
| `"already_gone"` | Lock didn't exist (already expired or released) — treated as success |
| `"corrupt_deleted"` | Lock had corrupt JSON; deleted anyway — treated as success |
| `"wrong_owner"` | `adminId` doesn't match current lock holder |
| `"token_mismatch"` | `token` doesn't match current lock |
| `"missing_identity"` | `adminId` or `token` was empty — rejected before Redis call |

### Behavior

- Verifies `adminId` and `token` match the current lock holder (atomic Lua script)
- Deletes lock from Redis if ownership verified
- Broadcasts `LOCK_RELEASED` event to all admins
- Returns non-`200` only for auth/validation errors; ownership mismatches return `200` with `success: false`

---

## Error Codes

| Status | Meaning |
|--------|---------|
| `200 OK` | Request succeeded (check `success` field for lock operations) |
| `400 Bad Request` | Invalid entity, missing required fields (e.g., token on PATCH/DELETE) |
| `401 Unauthorized` | Admin not authenticated or lacks admin role |
| `409 Conflict` | Row locked by another admin (POST), or heartbeat rejected (PATCH) |
| `500 Internal Server Error` | Server error |

---

## Rate Limiting

These endpoints are authenticated but not rate-limited by default. If high-frequency polling becomes a problem, consider adding:

```typescript
import { authenticatedApiRateLimit } from "@/lib/essentials/rateLimit";

const result = await authenticatedApiRateLimit.limit(`admin:${adminId}`, {
  rate: 30,
  window: 60000,
});

if (!result.success) {
  return NextResponse.json({ message: "Rate limited" }, { status: 429 });
}
```

## Related Files

- [lib/admin/realtime/concurrency/rowConcurrency.ts](../lib/admin/realtime/concurrency/rowConcurrency.ts) – Lock management logic
- [lib/admin/realtime/concurrency/adminRealtimeEvents.ts](../lib/admin/realtime/concurrency/adminRealtimeEvents.ts) – Event types and encoding
- [lib/admin/realtime/concurrency/rowSyncFetchers.ts](../lib/admin/realtime/concurrency/rowSyncFetchers.ts) – Row fetching logic
- [lib/realtime/realtimeClient.ts](../lib/realtime/realtimeClient.ts) – Client-side SSE handling
