# Realtime Book Availability

## Overview

BookWise streams book inventory changes to clients viewing a book detail page. When a borrow request is created, approved, rejected, expired, or returned, the client receives a realtime inventory update and refreshes the displayed available-copy count without a page reload.

Public stream endpoint:

```text
GET /api/book/stream?bookId=<book-id>
```

This stream is public-facing, so it intentionally emits only inventory-safe events.

## What Triggers Updates

Book availability events are published whenever the reservation or borrow counters change:

- user creates a request: `reservedCount + 1`
- admin approves a request: `reservedCount - 1`, `borrowedCount + 1`
- admin rejects a request: `reservedCount - 1`
- reservation-expiry cron rejects stale requests: `reservedCount - n`
- user or admin returns a borrowed book: `borrowedCount - 1`

Since:

```text
availableCopies = totalCopies - borrowedCount - reservedCount
```

every counter change can produce a new public availability value.

## Message Model

### Public Message

```typescript
type BookUpdatedMessage = {
  type: "BOOK_UPDATED";
  timestamp: string;
  bookId: string;
  availableCount: number;
  reservedCount: number;
  borrowedCount: number;
};
```

### Internal Message

The realtime layer also defines:

```typescript
type RequestUpdatedMessage = {
  type: "REQUEST_UPDATED";
  timestamp: string;
  requestId: string;
  bookId: string;
  userId: string;
  status: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED";
};
```

This is part of the shared borrowing event model, but `/api/book/stream` only forwards `BOOK_UPDATED`.

### Replayable Event Envelope

Published Redis events are wrapped with a monotonic id so reconnecting SSE clients can resume cleanly:

```typescript
type BorrowBookRealtimeEvent = {
  id: number;
  event: "BOOK_UPDATED" | "REQUEST_UPDATED";
  message: BorrowBookRealtimeMessage;
  publishedAt: string;
};
```

## SSE Wire Format

The stream now emits proper SSE ids and event names:

```text
id: 1042
event: BOOK_UPDATED
data: {"type":"BOOK_UPDATED","timestamp":"...","bookId":"...","availableCount":2,"reservedCount":1,"borrowedCount":3}
```

This allows browsers to send `Last-Event-ID` automatically when reconnecting.

## Server Architecture

### 1. Publisher

Inventory-changing flows call:

```typescript
broadcastBookAvailabilityUpdate(
  bookId,
  availableCount,
  reservedCount,
  borrowedCount,
);
```

That publishes a `BOOK_UPDATED` message into a dedicated borrowing realtime channel.

### 2. Redis Publish + Replay Buffer

`lib/admin/realtime/dashboardRedisPubSub.ts` now does three things for book events:

1. increments `book:borrow:realtime:sequence`
2. appends the event to `book:borrow:realtime:recent`
3. publishes the event to `book:borrow:realtime`

Important keys:

- channel: `book:borrow:realtime`
- sequence key: `book:borrow:realtime:sequence`
- replay list: `book:borrow:realtime:recent`

The replay list is trimmed to the most recent `250` events.

### 3. Public SSE Route

`app/api/book/stream/route.ts`:

- runs on `nodejs`
- is `force-dynamic`
- resolves identity from session or IP
- rate-limits the SSE handshake separately from normal API traffic
- acquires a Redis-backed connection lease
- reads `Last-Event-ID`
- replays missed events from Redis
- subscribes to live Redis Pub/Sub updates
- emits keepalive comments and SSE retry metadata

Filtering behavior:

- if `bookId` is present, only that book's events are sent
- if `bookId` is omitted, all public book inventory events are sent

## Why This Replaced The Old Design

The earlier version had two flawed protections:

- IP-based `5/min` limiting on the stream handshake
- a process-level `100` listener cap

That design breaks down because:

- a single dev browser session can reconnect many times
- React Strict Mode and HMR create extra connects in development
- `EventSource` already reconnects automatically
- process memory does not represent global capacity on Vercel

The new design replaces that with:

- identity-aware SSE handshake limits
- Redis-backed concurrent connection leases
- replay support via `Last-Event-ID`

## Distributed Connection Control

The stream no longer uses an in-memory global listener cap.

Instead it acquires a Redis lease per identity:

- anonymous limit: `2` open streams
- authenticated limit: `3` open streams

Lease flow:

1. increment `sse:book-stream:connections:<identity>`
2. set a `90s` TTL
3. reject if the count exceeds the configured limit
4. refresh the TTL on keepalive
5. decrement on disconnect

This is not a perfect global connection registry, but it is serverless-safe and far more accurate than instance-local memory.

## Reconnect Behavior

### Server Side

On connect, the route writes:

- `retry: <ADMIN_DASHBOARD_SSE_RETRY_MS>`
- replayed events newer than `Last-Event-ID`
- live events from Redis Pub/Sub
- `: keepalive` comments every keepalive interval

If the Redis subscription fails, the route emits a final close event and shuts down the stream.

### Client Side

`components/book/BookOverview.tsx` now relies on native `EventSource` reconnect behavior instead of closing and reopening the stream manually on every error.

This is safer because double reconnect loops can multiply handshake volume and trigger avoidable `429` responses.

Current client behavior:

- open one `EventSource` per mounted book page
- listen to default `message` events
- parse `BOOK_UPDATED`
- update `availableCopies`
- close the stream on unmount

## Rate Limiting

The public stream uses a separate rate-limit policy from normal API requests.

Current handshake thresholds:

- anonymous clients: `12 connects / minute`
- authenticated clients: `30 connects / minute`

These limits are applied before the connection lease is granted.

If a limit trips, the route returns:

```text
429 Too Many Requests
```

with rate-limit headers such as:

- `Retry-After`
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

If the identity already has too many open streams, the route also returns:

- `X-Connection-Limit`

## Scaling Notes

### At 1,000 concurrent users

This design is reasonable if publish volume is moderate and users are mostly holding one stream open.

### At 10,000 concurrent users

The main costs become:

- long-lived serverless execution
- outbound SSE bandwidth
- Redis subscription and publish volume

### At 100,000 concurrent users

Plain SSE on serverless infrastructure becomes a questionable fit. At that point, consider:

- WebSockets
- a dedicated managed realtime fanout service
- architectural separation between public realtime and admin/internal realtime

## Related Files

- `app/api/book/stream/route.ts`
- `components/book/BookOverview.tsx`
- `lib/admin/realtime/borrowBookRealtimeEvents.ts`
- `lib/admin/realtime/dashboardRedisPubSub.ts`
- `lib/admin/realtime/dashboardSocketServer.ts`
- `lib/essentials/rateLimit.ts`
- `app/api/book/cron/expire-reservations/route.ts`
