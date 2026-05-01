# BookWise Realtime System - Complete Guide

## Overview

BookWise implements a comprehensive real-time system with three main components:

1. **Admin Row-Level Realtime** – Optimistic locking + data mutations with SSE
2. **Admin Dashboard Realtime** – Coordinated dashboard refresh signals
3. **Book Availability Realtime** – Public inventory stream for users

This guide provides a complete overview and links to detailed documentation.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ BookWise Realtime System                                    │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ Admin Row Realtime               │     │ Admin Dashboard Realtime         │
├──────────────────────────────────┤     ├──────────────────────────────────┤
│ • Row locking (60s TTL)          │     │ • Coordinated refresh signals    │
│ • Version conflict detection     │     │ • Per-instance broker fanout     │
│ • CREATE/UPDATE/DELETE events    │     │ • 3000ms refresh window          │
│ • Reference-counted SSE stream   │     │ • Dashboard snapshot API         │
└──────────────────────────────────┘     └──────────────────────────────────┘
        ↓                                         ↓
   Redis Pub/Sub                            Redis Pub/Sub
   Channels:                                Channel:
   • borrow_requests                        • admin:dashboard:refresh
   • account_requests
   • books
   • users
   • locks
        ↓                                         ↓
   SSE Endpoint:                            SSE Endpoint:
   /api/admin/realtime/rows                 /api/admin/dashboard/realtime
        ↓                                         ↓
   Authenticated Admins                    Authenticated Admins
   (BorrowTable, UserTable, etc.)         (Admin Dashboard Page)


┌──────────────────────────────────┐
│ Book Availability Realtime       │
├──────────────────────────────────┤
│ • Public SSE stream              │
│ • BOOK_UPDATED events            │
│ • 250-event replay buffer        │
│ • Rate limited by IP             │
└──────────────────────────────────┘
        ↓
   Redis Pub/Sub
   Channel:
   • book:borrow:realtime
        ↓
   SSE Endpoint:
   /api/book/stream
        ↓
   Anonymous Users & Guests
   (Book Catalog, Search, etc.)
```

## Three Realtime Subsystems

### 1. Admin Row Realtime

**What**: Real-time coordination of row edits with optimistic locking

**Who**: Admin dashboard (tables: BorrowTable, UserTable, AccountTable, BookTable)

**How**:

- When admin opens edit form → acquires lock on row (60s TTL)
- Other admins see "Currently being edited by Jane Admin"
- Lock refreshes every 20s while editing (heartbeat)
- When admin saves → version conflict detection prevents overwrites
- All edits broadcast as CREATE/UPDATE/DELETE events

**Key Files**:

- [Realtime Client SSE](Realtime_Client_SSE.md) – Low-level SSE connection
- [Admin Row Concurrency](Admin_Row_Concurrency.md) – Lock lifecycle
- [Admin Realtime Events](Admin_Realtime_Events.md) – Event types
- [Admin Realtime API Routes](Admin_Realtime_API_Routes.md) – Endpoints
- [Realtime Hooks](Realtime_Hooks.md) – React hooks

**Endpoints**:

```
GET  /api/admin/realtime/rows      – SSE stream for row events + locks
GET  /api/admin/locks              – Fetch current locks for rows
POST /api/admin/locks              – Acquire a lock
DELETE /api/admin/locks            – Release a lock
GET  /api/admin/sync               – Re-sync locks + rows after reconnect
```

**Connection Lifecycle**:

1. BorrowTable mounts → calls `useRealtimeCore()`
2. First consumer → `connect()` opens EventSource to `/api/admin/realtime/rows`
3. EventSource subscribes to 5 Redis channels (4 entity types + locks)
4. Events stream in via SSE
5. Hooks update UI optimistically
6. All tables share one EventSource (reference counting)
7. Last table unmounts → `disconnect()` closes EventSource

**Flow Example: Approving a Request**

```
1. Admin clicks "Approve" on a pending request
2. useRealtimeUpdates optimistically changes status to BORROWED
3. Admin sees row update immediately
4. Server saves to DB + increments borrowedCount, decrements reservedCount
5. Server publishes BOOK_UPDATED event to Redis (from borrowBookRealtimeEvents)
6. Server publishes row UPDATE event to "borrow_requests" channel
7. All connected admins receive events via SSE
8. All tables apply updates (merge with local, version check)
9. If admin had row locked, their version wins; otherwise server wins
10. UI stays consistent across all admin sessions
```

### 2. Admin Dashboard Realtime

**What**: Coordinated refresh signals for the admin dashboard statistics

**Who**: Admin dashboard page (Statistics widget)

**How**:

- When any mutation happens → server publishes "dashboard:refresh" signal
- Each app instance has one Redis subscription → fans signal to all connected admins
- Each admin waits 3000ms (batching window) → fetches fresh dashboard snapshot
- All widgets update together

**Key Files**:

- [Admin_Dashboard_Realtime.md](Admin_Dashboard_Realtime.md) – Detailed architecture
- `lib/admin/realtime/dashboardRedisPubSub.ts` – Redis publish/subscribe
- `lib/admin/realtime/dashboardRealtimeBroker.ts` – Per-instance broker
- `lib/admin/realtime/useAdminDashboardRealtime.ts` – React hook

**Endpoints**:

```
GET  /api/admin/dashboard/realtime – SSE stream for refresh signals
GET  /api/admin/dashboard          – Fetch dashboard snapshot
```

**Why Separate from Row Realtime?**

- Row realtime pushes delta events (individual row changes)
- Dashboard realtime pushes summary refresh signals
- Dashboard doesn't need row-level precision, just wants to stay in sync
- Dashboard has different latency requirements (batching vs. immediate)

### 3. Book Availability Realtime

**What**: Public SSE stream for book inventory availability

**Who**: Unauthenticated users, guests browsing catalog

**How**:

- When book inventory changes → server publishes BOOK_UPDATED event
- Events are replay-buffered (last 250 events)
- Late-arriving clients get replay, then live events
- Clients can filter by specific bookId or subscribe to all

**Key Files**:

- [Book_Availability_Realtime.md](Book_Availability_Realtime.md) – Complete guide
- `lib/admin/realtime/concurrency/borrowBookRealtimeEvents.ts` – Event types
- `lib/admin/realtime/dashboardRedisPubSub.ts` – Publishing

**Endpoints**:

```
GET  /api/book/stream              – Public SSE for inventory updates
```

**Rate Limiting**: 2 concurrent connections per IP

**Why Public?**

- Users should see real-time availability
- Prevents users requesting books that just went out of stock
- No authentication required, but rate-limited

## Technology Stack

### Redis

- **Service**: Upstash Redis (serverless)
- **Purpose**: Pub/Sub for event distribution, Locks storage, Event replay buffer
- **Client**: `@upstash/redis`

### EventSource (SSE)

- **Standard**: W3C Server-Sent Events
- **Connection**: Long-lived HTTP (no WebSocket needed)
- **Reconnect**: Built-in; exponential backoff
- **Heartbeats**: Named events every 15s (admin), generic comments every 30s (public)

### React Hooks

- **`useRealtimeCore`** – Connection lifecycle + reference counting
- **`useRowLock`** – Row lock subscription + heartbeat
- **`useRealtimeUpdates`** – Row event handling + conflict resolution
- **`useOptimisticUpdate`** – Rollback helper

### Database

- **PostgreSQL** with Drizzle ORM
- **Constraints**: No transactions on Neon HTTP driver
- **Solution**: Atomic updates via CTE (Common Table Expression) SQL
- **Versioning**: Row-level version field for conflict detection

## Key Concepts

### Optimistic Locking

Admin 1 loads a book with `version=5`
Admin 2 loads the same book with `version=5`
Admin 1 saves changes → DB updates to `version=6`
Admin 2 tries to save → WHERE `version=5` fails → conflict error
Admin 2 must refresh and retry

**Files**: [Admin Row Concurrency](Admin_Row_Concurrency.md)

### Reference Counting

Multiple tables need SSE connection:

```
useRealtimeCore in BorrowTable  → mountCount = 1 → connect()
useRealtimeCore in UserTable    → mountCount = 2 → (skip, already open)
useRealtimeCore in AccountTable → mountCount = 3 → (skip, already open)

AccountTable unmounts           → mountCount = 2 → (skip, others remain)
UserTable unmounts              → mountCount = 1 → (skip, BorrowTable remains)
BorrowTable unmounts            → mountCount = 0 → disconnect()
```

**Files**: [Realtime Client SSE](Realtime_Client_SSE.md), [Realtime Hooks](Realtime_Hooks.md)

### Heartbeat Detection

Server sends SSE heartbeat every 15s:

- Client tracks `lastHeartbeat = Date.now()`
- Every 5s, check if `Date.now() - lastHeartbeat > 30s`
- If yes → connection is stale → reconnect
- On new heartbeat → reset exponential backoff to 100ms

**Why?** Network proxies silently drop idle connections. Heartbeats keep connection alive.

**Files**: [Realtime Client SSE](Realtime_Client_SSE.md)

### Event Replay

Public `/api/book/stream` keeps last 250 events in Redis list.

Late-arriving client:

1. Connects to `/api/book/stream`
2. Server sends replay (all stored events)
3. Client applies replay to compute current state
4. Client then listens for live events

**Example**:

- Event 1: BOOK_UPDATED bookId=123, availableCount=5
- Event 2: BOOK_UPDATED bookId=123, availableCount=4
- Event 3: BOOK_UPDATED bookId=456, availableCount=2
- New subscriber connects → gets events 1, 2, 3 → knows bookId=123 has 4 available

**Files**: [Book Availability Realtime](Book_Availability_Realtime.md)

### Stale Data Detection & Resync

Periodic resync every 60 seconds:

```
onPeriodicResync() →
  BorrowTable.onResync() →
    fetch `/api/admin/sync?entity=borrow_requests&includeRows=true` →
      re-hydrate rows + locks →
        re-apply filters, sorting, etc.
```

Also triggered on reconnect (when status goes from `reconnecting` → `connected`).

**Files**: [Realtime Hooks](Realtime_Hooks.md)

## Event Flow Examples

### Example 1: Admin Approves a Request

```
1. Admin clicks "Approve" on pending request ID=req-123, book=book-456

2. Frontend (useOptimisticUpdate):
   - Immediately update row: status = BORROWED
   - UI shows new status immediately

3. Backend API (/api/admin/borrow/approve):
   - Update DB: borrowRecords.set({ status: BORROWED, version: 6 })
   - Update DB: books.set({ borrowedCount++, reservedCount-- })
   - Publish to admin row events: event kind=row, type=UPDATE, channel=borrow_requests
   - Publish to book availability: event type=BOOK_UPDATED, bookId=book-456
   - Publish admin dashboard refresh: event type=dashboard:refresh

4. Redis Pub/Sub:
   - borrow_requests channel gets UPDATE event
   - book:borrow:realtime channel gets BOOK_UPDATED event
   - admin:dashboard:refresh channel gets refresh signal

5. All Connected Admins (via /api/admin/realtime/rows SSE):
   - Receive UPDATE event for req-123
   - useRealtimeUpdates merges: server version=6 > local version=5, apply
   - UI updates (if they had different local state, server wins)

6. Dashboard on all Admin Sessions:
   - useAdminDashboardRealtime waits 3000ms
   - Fetches fresh /api/admin/dashboard
   - Statistics widget re-renders with new totals

7. Public Users (via /api/book/stream SSE):
   - Receive BOOK_UPDATED event: availableCount decreased
   - UI shows book has 1 fewer copy available
```

### Example 2: User Creates Borrow Request

```
1. User clicks "Request Book" in catalog

2. Frontend:
   - Show optimistic button state: "Requesting..."
   - POST /api/book/requests { bookId: book-456 }

3. Backend API (/api/book/requests):
   - Insert borrowRecord: status=PENDING, reservedAt=now
   - Update books: reservedCount++
   - Publish BOOK_UPDATED to book:borrow:realtime

4. Response to user:
   - success: true, requestId: req-789

5. Frontend:
   - Show: "Request submitted"
   - In background, listen to /api/book/stream

6. All Users Seeing book-456:
   - Receive BOOK_UPDATED event
   - availableCount decreased
   - UI updates without refresh

7. Admin Dashboard:
   - Pending request count increased
   - After next refresh (or manual), shows new request

8. Admin Opens Borrow Requests Table:
   - Sees new request from user
   - Can lock it for editing (add notes, etc.)
   - Can approve/reject
```

### Example 3: SSE Reconnect → Resync

```
1. Internet drops for 10 seconds

2. Client detects disconnect:
   - SSE error event fires
   - Browser auto-reconnects after 2s (retry: 2000)
   - Multiple attempts with exponential backoff

3. SSE Reconnects (status: reconnecting → connected):
   - useRealtimeCore.onResync() called
   - BorrowTable.handleResync() called
   - Fetch /api/admin/sync?entity=borrow_requests&includeRows=true

4. Server Response:
   - Locks: { req-123: null, req-456: { adminId: ..., expiresAt: ... } }
   - Rows: [ { id: req-123, status: APPROVED, version: 6 }, ... ]

5. Client Merge:
   - Lock state from response
   - Rows compared with local:
     - If local version < server version → apply server
     - If local version >= server version → keep local (being edited)

6. UI Updates:
   - All rows re-rendered with fresh data
   - Lock indicators updated
   - Pinned row (being edited) keeps its position

7. All Events During Disconnect:
   - Missed (no replay buffer for admin row events)
   - But resync fetches all rows, so consistent

8. Live Events Resume:
   - Further changes come through immediately
   - Client applies incrementally
```

## Configuration

### Environment Variables

```bash
# Redis
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...

# Optional: Cron secret for expiry endpoint
CRON_SECRET=...
```

### Constants (lib/essentials/rateLimit.ts, admin/realtime/...)

```typescript
// SSE Heartbeat
ADMIN_ROW_REALTIME_HEARTBEAT_MS = 15_000;
ADMIN_ROW_REALTIME_RETRY_MS = 2_000;

// Locks
ROW_LOCK_TTL_MS = 60_000;
ROW_LOCK_HEARTBEAT_MS = 20_000;

// Connection Limits
ANONYMOUS_SSE_CONNECTION_LIMIT = 2; // per IP
AUTHENTICATED_SSE_CONNECTION_LIMIT = 3;

// Book Availability
BORROW_BOOK_REALTIME_REPLAY_LIMIT = 250; // events to keep
```

## Troubleshooting Guide

### "Connection refused" on SSE endpoint

- Check admin is authenticated (`session.user.role === "ADMIN"`)
- Verify `/api/admin/realtime/rows` endpoint exists
- Check Redis connection
- Look for errors in server logs

### Rows not updating in real-time

- Check that mutations call `publishEvent()` to Redis
- Verify client is receiving SSE messages (DevTools Network tab)
- Check `useRealtimeUpdates` is mounted with correct `entity`
- Verify event type guards pass (`isAdminRealtimeEvent`)

### "Currently being edited by" lock won't go away

- Check lock TTL hasn't expired yet (`redis-cli TTL lock:books:id`)
- Refresh page to force resync
- Or wait 60 seconds (lock auto-expires)

### Lost events after reconnect

- Row realtime doesn't have replay buffer (admin re-syncs entire table)
- Book availability stream has 250-event replay buffer
- For row events: resync always fetches fresh state

### Rate limit "429 Too Many Requests"

- Admin realtime: checked per admin per IP, configured in `rateLimit.ts`
- Public book stream: 2 connections per IP
- Close unused SSE connections
- Or increase limits if legitimate high-frequency traffic

### High Redis memory usage

- Event replay buffer (`BORROW_BOOK_REALTIME_REPLAY_LIMIT = 250`)
- Increase limit if you need longer history
- Lock storage auto-expires (60s TTL)
- Monitor Redis memory with `redis-cli INFO memory`

## Best Practices

### 1. Always Unsubscribe

```typescript
useEffect(() => {
  const unsubscribe = onMessage(handler);
  return () => unsubscribe();
}, []);
```

### 2. Handle Resync Gracefully

```typescript
const handleResync = async () => {
  try {
    const res = await fetch("/api/admin/sync?entity=...");
    const data = await res.json();
    if (data.success) {
      setRows(data.rows);
      setLocks(data.locks);
    }
  } catch (error) {
    // Fail silently — keep local state until next retry
    console.error("Resync failed:", error);
  }
};
```

### 3. Use Optimistic Updates for UX

```typescript
// Remove optimistically
const previous = removeItem(id);

try {
  await delete();
} catch {
  // Restore on error
  restoreItem(previous);
}
```

### 4. Let Version Conflicts Guide You

```typescript
// Don't override server data if it's newer
if (isServerRowNewer(server, local)) {
  // Apply server
} else {
  // Keep local (you're editing it)
}
```

### 5. Monitor Connection Status

```typescript
const { status } = useRealtimeCore({ onResync });

if (status === "disconnected") {
  // Show warning banner
}
```

## Performance Considerations

### Database

- Use indexed columns: `available_copies`, `book_status`, `reserved_at`
- Avoid N+1 queries when fetching rows for sync
- Batch lock lookups (use `listRowLocks` not individual gets)

### Redis

- Pub/Sub is memory-efficient (doesn't persist)
- Replay buffer capped at 250 events
- Locks auto-expire (no cleanup needed)
- Monitor connections: `redis-cli CLIENT LIST | wc -l`

### Client

- Reference counting keeps single EventSource per tab
- Resync debounced to 5s minimum
- No polling (only event-driven updates)
- Heartbeat keeps connection alive (vs. polling every 30s)

### Network

- SSE more efficient than polling
- No WebSocket overhead
- Inherits HTTP/2 multiplexing benefits
- Proxies & load-balancers must support `X-Accel-Buffering: no`

## Future Improvements

1. **Replay for Admin Row Events**: Currently re-sync entire table; could keep event replay buffer
2. **Fine-Grained Permissions**: Separate locks by role or entity type
3. **Offline Support**: Service Worker + IndexedDB for optimistic updates
4. **Metrics**: Track latency, event counts, dropped connections
5. **Admin Audit Log**: Record all locks + edits with timestamps
