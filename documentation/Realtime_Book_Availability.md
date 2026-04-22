# Realtime Book Availability

## Overview

BookWise streams book inventory updates to clients viewing a book detail page. When a request is created, approved, rejected, expired, or returned, connected clients receive a realtime event and immediately update the displayed availability.

The current public stream endpoint is:

```text
GET /api/book/stream?bookId=<book-id>
```

## What Triggers Updates

Book availability events are published when any flow changes inventory counters:

- User creates a request: `reservedCount + 1`
- Admin approves a request: `reservedCount - 1`, `borrowedCount + 1`
- Admin rejects a request: `reservedCount - 1`
- Reservation expiry cron rejects stale requests: `reservedCount - n`
- User or admin returns a borrowed book: `borrowedCount - 1`

Because `availableCopies` is generated from `totalCopies - borrowedCount - reservedCount`, every counter change yields a new availability value.

## Event Contract

The public stream forwards only `BOOK_UPDATED` messages:

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

SSE payload format:

```text
data: {"type":"BOOK_UPDATED","timestamp":"...","bookId":"...","availableCount":2,"reservedCount":1,"borrowedCount":3}
```

The realtime layer also defines `REQUEST_UPDATED` messages internally, but `/api/book/stream` intentionally filters them out and exposes only inventory-safe public events.

## Server Architecture

### 1. Publisher

Server actions and route handlers call:

```typescript
broadcastBookAvailabilityUpdate(
  bookId,
  availableCount,
  reservedCount,
  borrowedCount,
);
```

That function publishes a `BOOK_UPDATED` message into the shared Redis pub/sub channel used by the realtime broker.

### 2. Broker

`dashboardRedisPubSub.ts` subscribes to the shared channel and accepts both:

- admin dashboard refresh messages
- borrow/inventory realtime messages

The book stream route attaches a listener through the existing broker and filters the mixed event feed before writing to the public SSE response.

### 3. Public SSE route

`app/api/book/stream/route.ts`:

- runs as `nodejs`
- is `force-dynamic`
- reads an optional `bookId` query parameter
- forwards only matching `BOOK_UPDATED` events
- sends SSE retry metadata and keepalive comments

Filtering behavior:

- if `bookId` is present, only updates for that book are sent
- if `bookId` is omitted, all public book inventory updates are sent

## Rate Limiting And Connection Caps

The public stream includes lightweight abuse protection:

- IP-based rate limiting via `safeRateLimit(ratelimit, ip)`
- a process-level listener cap of `100` concurrent stream listeners

If either protection trips, the route returns:

```text
429 Too Many Requests
```

## Client Integration

`components/book/BookOverview.tsx` opens:

```typescript
new EventSource(`/api/book/stream?bookId=${id}`, {
  withCredentials: true,
});
```

Client behavior:

- listens to default `message` events
- parses the JSON payload
- updates local state when `payload.type === "BOOK_UPDATED"`
- retries after 2 seconds if the stream errors
- closes the connection on unmount

The UI currently updates the displayed `availableCopies` count only, while the event still carries `reservedCount` and `borrowedCount` for future enhancements.

## Keepalive And Retry

The stream writes:

- `retry: <ADMIN_DASHBOARD_SSE_RETRY_MS>` on connect
- `: keepalive` comments on an interval using `ADMIN_DASHBOARD_SSE_KEEPALIVE_MS`

This helps clients reconnect cleanly and keeps long-lived HTTP connections from going idle.

## Related Files

- `app/api/book/stream/route.ts`
- `components/book/BookOverview.tsx`
- `lib/admin/realtime/borrowBookRealtimeEvents.ts`
- `lib/admin/realtime/dashboardRedisPubSub.ts`
- `lib/admin/realtime/dashboardSocketServer.ts`
- `app/api/book/cron/expire-reservations/route.ts`
