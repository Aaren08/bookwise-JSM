# Admin Realtime API Routes

## Overview

Three API routes coordinate the admin realtime system:

1. **`GET /api/admin/realtime/rows`** – Server-Sent Events stream for all admin events
2. **`GET /api/admin/sync`** – Sync/re-hydrate locks and rows after reconnect
3. **`GET|POST|PATCH|DELETE /api/admin/locks`** – Acquire/release row locks

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

The `X-Accel-Buffering: no` header prevents Nginx/Vercel edge from buffering the stream.

### Event Stream Format

Server-Sent Events format with two types of events:

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
  "borrow_requests", // borrow records with relationships
  "account_requests", // pending users
  "books", // books table
  "users", // approved users
  "locks", // all lock events
];
```

The server maintains one Redis subscription to all channels. Each channel filters events by entity type.

### Implementation Details

```typescript
export async function GET(request: Request) {
  // 1. Verify admin authentication
  try {
    await requireAdminActor();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Create ReadableStream for SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;

      // 3. Subscribe to Redis channels
      const subscription = redis.subscribe(CHANNELS);

      // 4. Send retry directive
      enqueue(`retry: ${ADMIN_ROW_REALTIME_RETRY_MS}\n\n`);

      // 5. Send immediate heartbeat
      enqueue(encodeHeartbeatEvent());

      // 6. Listen for Redis messages
      subscription.on("message", (payload) => {
        try {
          const parsed = JSON.parse(payload.message);
          if (!isAdminRealtimeEvent(parsed)) return;
          enqueue(encodeAdminRealtimeEvent(parsed));
        } catch (error) {
          devLog("Failed to parse admin realtime payload:", error);
        }
      });

      // 7. Send heartbeat every 15 seconds
      const heartbeat = setInterval(() => {
        enqueue(encodeHeartbeatEvent());
      }, ADMIN_ROW_REALTIME_HEARTBEAT_MS);

      // 8. Handle client disconnect
      const close = () => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(heartbeat);
        void subscription.unsubscribe();
        controller.close();
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, { headers: { ... } });
}
```

### Error Handling

- **401 Unauthorized**: Admin is not authenticated or lacks admin role
- **Parse Errors**: Invalid JSON from Redis is logged and skipped (doesn't close stream)
- **Redis Errors**: Logged but don't close stream; client will reconnect after timeout

### Client Reconnection

When the client detects a closed connection:

1. Wait 2000ms (the `retry:` value)
2. Attempt to reconnect
3. Use exponential backoff if reconnects fail (100ms → 200ms → 400ms … max 30s)
4. Backoff resets when first heartbeat arrives after reconnect

## Endpoint: GET /api/admin/sync

Fetch current locks and optionally row data for the given entity and IDs.

### Purpose

Called by clients:

1. After every SSE reconnect (to re-hydrate state)
2. Periodically every 60 seconds (safety resync)
3. When user clicks "Refresh Table"

### Query Parameters

- **`entity`** (required): One of `borrow_requests`, `account_requests`, `books`, `users`
- **`ids`** (optional): Comma-separated row IDs. If omitted, returns first-page data.
- **`includeRows`** (optional): When `"true"`, response includes `rows[]` data

### Request Example

```
GET /api/admin/sync?entity=books&ids=550e8400...,550e8400...&includeRows=true
Authorization: Bearer <session-token>
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
      "token": "a1b2c3..."
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

### Response Fields

- **`locks`**: Key-value map where key is row ID, value is lock info or null
- **`rows`**: Array of row data (only if `includeRows=true`)
- **`syncedAt`**: ISO timestamp when sync was performed

### Fetch Logic

When `ids` is empty, fetches first page (20 rows) per entity:

```typescript
const fetchEntityRows = async (
  entity: AdminRealtimeEntity,
  ids: string[],
): Promise<unknown[]> => {
  switch (entity) {
    case "borrow_requests":
      // If ids provided, fetch those; else fetch first 20 by date
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
{
  "message": "Invalid entity"
}

// 401 Unauthorized
{
  "message": "Unauthorized"
}
```

## Endpoint: GET /api/admin/locks

Fetch current locks for specified row IDs.

### Query Parameters

- **`entity`** (required): One of `borrow_requests`, `account_requests`, `books`, `users`
- **`ids`** (optional): Comma-separated row IDs

### Response Example

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
      "token": "a1b2c3..."
    },
    "550e8400-e29b-41d4-a716-446655440001": null
  }
}
```

## Endpoint: POST /api/admin/locks

Acquire a row lock.

### Request Body

```json
{
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "a1b2c3..."
}
```

**Fields**:

- **`entity`** (required): Entity type
- **`entityId`** (required): Row ID to lock
- **`token`** (optional): Token for refreshing existing lock

### Response on Success

```json
{
  "success": true,
  "lock": {
    "entity": "books",
    "entityId": "550e8400-e29b-41d4-a716-446655440000",
    "adminId": "admin-456",
    "adminName": "Jane Admin",
    "expiresAt": "2026-04-29T10:20:00Z",
    "token": "a1b2c3..."
  }
}
```

### Response on Lock Held by Another Admin

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
    "token": "xyz..."
  }
}
```

Status: `409 Conflict`

### Behavior

- If no lock exists, acquires it with 60s TTL
- If current admin holds the lock, refreshes it (resets TTL)
- If another admin holds the lock, returns their lock info
- Broadcasts `LOCK_ACQUIRED` event to all admins

## Endpoint: PATCH /api/admin/locks

Alias for `POST` – can also be used to acquire/refresh locks.

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

**Fields**:

- **`entity`** (required): Entity type
- **`entityId`** (required): Row ID to unlock
- **`token`** (required): Token from lock acquisition

### Response on Success

```json
{
  "success": true,
  "lock": null,
  "message": "Lock released"
}
```

### Response on Token Mismatch

```json
{
  "success": false,
  "lock": {
    "entity": "books",
    "entityId": "550e8400-e29b-41d4-a716-446655440000",
    "adminId": "admin-789",
    "adminName": "John Admin",
    "expiresAt": "2026-04-29T10:15:00Z",
    "token": "xyz..."
  },
  "message": "Lock not owned by current admin"
}
```

### Behavior

- Verifies admin ID and token match the current lock holder
- Deletes lock from Redis if ownership verified
- Broadcasts `LOCK_RELEASED` event to all admins
- Returns error if token doesn't match or no lock exists

## Error Codes

| Status                      | Meaning                                     |
| --------------------------- | ------------------------------------------- |
| `200 OK`                    | Request succeeded                           |
| `400 Bad Request`           | Invalid entity, missing required fields     |
| `401 Unauthorized`          | Admin not authenticated or lacks admin role |
| `409 Conflict`              | Row locked by another admin (for POST)      |
| `500 Internal Server Error` | Server error                                |

## Rate Limiting

These endpoints are authenticated but not rate-limited by default. If high-frequency polling becomes a problem, consider adding:

```typescript
import { authenticatedApiRateLimit } from "@/lib/essentials/rateLimit";

// Per admin per minute
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
