# Book Availability Realtime System

## Overview

The book availability realtime system provides a public SSE stream for tracking inventory changes across the entire platform. Users receive real-time updates on book availability without needing to refresh pages.

## Architecture

### Components

1. **Event Types** (`lib/admin/realtime/concurrency/borrowBookRealtimeEvents.ts`)
   - `BOOK_UPDATED`: Inventory changes (available/borrowed/reserved counts)
   - `REQUEST_UPDATED`: Request status changes (PENDING, BORROWED, RETURNED, LATE_RETURN, REJECTED)

2. **Publishing** (`lib/admin/realtime/dashboardRedisPubSub.ts`)
   - `publishBookAvailabilityUpdate()` – broadcast inventory changes
   - `getBorrowBookRealtimeReplay()` – fetch recent events for new subscribers
   - `subscribeToBorrowBookUpdates()` – subscribe to Redis channel

3. **Public Stream Endpoint** (`GET /api/book/stream`)
   - Filters events by `bookId` (optional)
   - Rate-limited by IP
   - No authentication required

## Event Types

### BookUpdatedMessage

Fired when a book's inventory changes (e.g., when a request is approved/rejected/returned).

```typescript
type BookUpdatedMessage = {
  type: "BOOK_UPDATED";
  timestamp: string; // ISO timestamp
  bookId: string; // book UUID
  availableCount: number; // total_copies - borrowed_count - reserved_count
  reservedCount: number; // pending requests
  borrowedCount: number; // active loans
};
```

**Example**

```json
{
  "id": 42,
  "event": "BOOK_UPDATED",
  "message": {
    "type": "BOOK_UPDATED",
    "timestamp": "2026-04-29T10:00:00Z",
    "bookId": "550e8400-e29b-41d4-a716-446655440000",
    "availableCount": 2,
    "reservedCount": 1,
    "borrowedCount": 2
  },
  "publishedAt": "2026-04-29T10:00:00Z"
}
```

**Triggers**:

- Admin approves a pending request → borrowedCount++, reservedCount--
- Admin rejects a pending request → reservedCount--
- User returns a borrowed book → borrowedCount--
- Cron expires a stale pending request → reservedCount--

### RequestUpdatedMessage

Fired when a request status changes (currently not exposed in public stream).

```typescript
type RequestUpdatedMessage = {
  type: "REQUEST_UPDATED";
  timestamp: string;
  requestId: string; // borrow_record UUID
  bookId: string; // book UUID
  userId: string; // user UUID
  status: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED";
};
```

**Note**: The public `/api/book/stream` endpoint filters this out; only `BOOK_UPDATED` is exposed.

## Event Publishing

### When Publishing Occurs

```typescript
export const publishBookAvailabilityUpdate = async (
  bookId: string,
  availableCount: number,
  reservedCount: number,
  borrowedCount: number,
) => {
  const message = createBookUpdatedMessage(
    bookId,
    availableCount,
    reservedCount,
    borrowedCount,
  );

  return publishBorrowBookRealtimeMessage(message);
};
```

### Example: Approving a Request

In `lib/admin/actions/borrow.ts` (or similar):

```typescript
export async function approveRequest(requestId: string) {
  // 1. Update database
  const [updatedRecord] = await db
    .update(borrowRecords)
    .set({ borrowStatus: "BORROWED", version: sql`version + 1` })
    .where(eq(borrowRecords.id, requestId))
    .returning();

  const book = await db.query.books.findFirst({
    where: eq(books.id, updatedRecord.bookId),
  });

  // 2. Publish event
  await publishBookAvailabilityUpdate(
    book.id,
    book.availableCopies,
    book.reservedCount,
    book.borrowedCount,
  );

  // 3. Update admin dashboard realtime
  await publishAdminDashboardUpdate();
}
```

## Event Storage & Replay

### Redis-Backed Event Log

Events are stored in a replay list for late-arriving subscribers:

```typescript
export const BORROW_BOOK_REALTIME_CHANNEL = "book:borrow:realtime";
export const BORROW_BOOK_REALTIME_REPLAY_KEY = "book:borrow:realtime:recent";
export const BORROW_BOOK_REALTIME_SEQUENCE_KEY =
  "book:borrow:realtime:sequence";
export const BORROW_BOOK_REALTIME_REPLAY_LIMIT = 250; // keep last 250 events
```

### Lua Script for Atomic Publishing

```typescript
const eventJson = await redis.eval(
  `
  local id = redis.call('INCR', KEYS[1])
  local message = cjson.decode(ARGV[1])
  local event = {
    id = id,
    event = ARGV[2],
    message = message,
    publishedAt = ARGV[3]
  }
  local eventJson = cjson.encode(event)
  redis.call('RPUSH', KEYS[2], eventJson)
  redis.call('LTRIM', KEYS[2], -tonumber(ARGV[4]), -1)
  redis.call('PUBLISH', KEYS[3], eventJson)
  return eventJson
  `,
  [
    BORROW_BOOK_REALTIME_SEQUENCE_KEY,
    BORROW_BOOK_REALTIME_REPLAY_KEY,
    BORROW_BOOK_REALTIME_CHANNEL,
  ],
  [
    JSON.stringify(message),
    message.type,
    new Date().toISOString(),
    BORROW_BOOK_REALTIME_REPLAY_LIMIT,
  ],
);
```

**What This Does**:

1. Increments a sequence counter to get unique event ID
2. Creates event object with message, event type, and timestamp
3. Appends event to replay list (Redis list)
4. Trims replay list to last 250 events
5. Publishes event to all subscribers
6. Returns the event JSON

### Late-Arriving Subscriber Flow

1. User opens book catalog page
2. Client connects to `GET /api/book/stream`
3. Server sends replay events from last N stored events
4. Client applies replay to initial state
5. Client then listens to live events
6. Client rebuilds inventory state with full history

```typescript
export const getBorrowBookRealtimeReplay = async (lastEventId?: number) => {
  const replay = await redis.lrange<string>(
    BORROW_BOOK_REALTIME_REPLAY_KEY,
    0,
    -1,
  );

  return replay
    .map((entry) => {
      try {
        return parsePubSubMessage(entry);
      } catch (error) {
        console.error("Failed to parse replayable book realtime event:", error);
        return null;
      }
    })
    .filter(isBorrowBookRealtimeEvent)
    .filter((event) =>
      typeof lastEventId === "number" ? event.id > lastEventId : true,
    )
    .sort((left, right) => left.id - right.id);
};
```

## Public API Endpoint: GET /api/book/stream

### Purpose

Stream real-time book availability updates to authenticated or anonymous users.

### Authentication

- No authentication required
- Rate-limited by IP address

### Query Parameters

- **`bookId`** (optional): Filter events to a specific book

### Response Headers

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

### Event Format

SSE format with event ID and named event type:

```
id: 42
event: BOOK_UPDATED
data: {"type":"BOOK_UPDATED","timestamp":"2026-04-29T10:00:00Z","bookId":"550e8400...","availableCount":2,"reservedCount":1,"borrowedCount":2}

id: 43
event: BOOK_UPDATED
data: {"type":"BOOK_UPDATED","timestamp":"2026-04-29T10:00:01Z","bookId":"550e8401...","availableCount":5,"reservedCount":0,"borrowedCount":0}

```

### Implementation Details

```typescript
export async function GET(request: Request) {
  // 1. Rate limit by IP
  const ip = getClientIp(request);
  const rateLimit = await anonymousSseConnectRateLimit.limit(`ip:${ip}`);

  if (!rateLimit.success) {
    return new Response("429 Too Many Requests", { status: 429 });
  }

  // 2. Manage connection lease
  const leaseId = addConnectionLease(ip);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;
      const subscription = redis.subscribe([BORROW_BOOK_REALTIME_CHANNEL]);

      // 3. Send replay events (so new subscribers get recent history)
      const replay = await getBorrowBookRealtimeReplay();
      for (const event of replay) {
        if (shouldInclude(event, bookId)) {
          controller.enqueue(encoder.encode(encodeBorrowBookSseEvent(event)));
        }
      }

      // 4. Listen for live events
      subscription.on("message", (data) => {
        try {
          const parsed = parsePubSubMessage(data.message);

          if (!isBorrowBookRealtimeEvent(parsed)) {
            return;
          }

          if (shouldInclude(parsed, bookId)) {
            controller.enqueue(
              encoder.encode(encodeBorrowBookSseEvent(parsed)),
            );
          }
        } catch (error) {
          console.error("Failed to parse book realtime message:", error);
        }
      });

      // 5. Handle disconnect
      const close = () => {
        if (isClosed) return;
        isClosed = true;
        removeConnectionLease(leaseId);
        void subscription.unsubscribe();
        controller.close();
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, { headers: { ... } });
}

const shouldInclude = (
  event: BorrowBookRealtimeEvent,
  bookId?: string,
): boolean => {
  if (!bookId) return true; // include all if no filter
  if (event.message.type === "BOOK_UPDATED") {
    return event.message.bookId === bookId;
  }
  return false; // REQUEST_UPDATED excluded
};
```

### Client Usage

#### Vanilla JavaScript

```javascript
const bookId = "550e8400-e29b-41d4-a716-446655440000";
const eventSource = new EventSource(`/api/book/stream?bookId=${bookId}`);

eventSource.addEventListener("BOOK_UPDATED", (event) => {
  const message = JSON.parse(event.data);
  console.log(
    `Book ${message.bookId}: ${message.availableCount} copies available`,
  );
  // Update UI
});

eventSource.onerror = () => {
  console.error("Stream disconnected");
  eventSource.close();
};
```

#### React Hook

```typescript
import { useEffect, useState } from "react";

export function useBookAvailability(bookId: string) {
  const [availability, setAvailability] = useState({
    availableCount: 0,
    reservedCount: 0,
    borrowedCount: 0,
  });

  useEffect(() => {
    const eventSource = new EventSource(`/api/book/stream?bookId=${bookId}`);

    eventSource.addEventListener("BOOK_UPDATED", (event) => {
      const message = JSON.parse(event.data);
      setAvailability({
        availableCount: message.availableCount,
        reservedCount: message.reservedCount,
        borrowedCount: message.borrowedCount,
      });
    });

    return () => eventSource.close();
  }, [bookId]);

  return availability;
}
```

### Rate Limiting

Limit: 2 concurrent connections per IP (for anonymous users)

```typescript
export const ANONYMOUS_SSE_CONNECTION_LIMIT = 2;
```

Limits are per-IP in the distributed Redis connection lease system. Each connection gets a TTL-tracked lease that auto-expires.

### Error Responses

- **`429 Too Many Requests`**: Rate limit exceeded
- **`500 Internal Server Error`**: Server error

## Type Guards and Validation

### isBorrowBookRealtimeEvent

Top-level validator for events:

```typescript
export const isBorrowBookRealtimeEvent = (
  value: unknown,
): value is BorrowBookRealtimeEvent => {
  if (!value || typeof value !== "object") return false;

  const event = value as Record<string, unknown>;

  return (
    typeof event.id === "number" &&
    typeof event.event === "string" &&
    typeof event.publishedAt === "string" &&
    isBorrowBookRealtimeMessage(event.message)
  );
};
```

### isBookUpdatedMessage

```typescript
export const isBookUpdatedMessage = (
  value: unknown,
): value is BookUpdatedMessage => {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;

  return (
    message.type === "BOOK_UPDATED" &&
    typeof message.timestamp === "string" &&
    typeof message.bookId === "string" &&
    typeof message.availableCount === "number" &&
    typeof message.reservedCount === "number" &&
    typeof message.borrowedCount === "number"
  );
};
```

## Inventory Update Rules

When availability is updated:

1. **Approve a pending request**:
   - `borrowedCount++`
   - `reservedCount--`
   - `availableCount = total - borrowed - reserved` ← auto-calculated

2. **Reject a pending request**:
   - `reservedCount--`

3. **Return a borrowed book**:
   - `borrowedCount--`

4. **Expire stale reservation** (15 min old):
   - `reservedCount--`

5. **User creates new request**:
   - `reservedCount++`

## Troubleshooting

### Events aren't arriving

Check:

1. Client is connected to `/api/book/stream` with status 200
2. Inventory is actually changing (mutations happening)
3. Redis is running
4. No rate limit errors (check response headers)

### Replay events missing for old events

The replay buffer keeps the last 250 events. If you need older history, increase `BORROW_BOOK_REALTIME_REPLAY_LIMIT` in the constants.

### Late subscriber doesn't receive replay

Check Redis logs for Lua script errors:

```
redis-cli LRANGE book:borrow:realtime:recent 0 10
```

### Too many connections from single IP

Adjust `ANONYMOUS_SSE_CONNECTION_LIMIT` if needed, but be aware of abuse. Consider authentication for higher limits.

## Related Files

- [lib/admin/realtime/concurrency/borrowBookRealtimeEvents.ts](../lib/admin/realtime/concurrency/borrowBookRealtimeEvents.ts) – Event types
- [lib/admin/realtime/dashboardRedisPubSub.ts](../lib/admin/realtime/dashboardRedisPubSub.ts) – Publishing logic
- [app/api/book/stream/route.ts](../app/api/book/stream/route.ts) – Public stream endpoint
- [lib/essentials/rateLimit.ts](../lib/essentials/rateLimit.ts) – Rate limiting config
