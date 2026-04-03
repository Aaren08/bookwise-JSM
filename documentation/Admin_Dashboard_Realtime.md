# Admin Dashboard Realtime Updates

## Overview

The admin dashboard now supports realtime updates through a WebSocket-based broadcast channel built with the `ws` package.

This implementation provides:

- Full-duplex WebSocket connections between each admin dashboard client and the server
- One-to-many broadcasting, where a single mutation can notify all connected admin users
- A 3000ms delayed refresh window so the dashboard remains visually stable and consistent with the existing statistics animation behavior
- A single reusable client hook for dashboard synchronization
- An authenticated snapshot API used to fetch fresh data after each broadcast

The feature is designed so that:

- Admin users receive live dashboard updates without manually refreshing the page
- User-originated actions such as sign-up and borrow requests become visible to admins automatically
- Admin-originated actions such as approving accounts, updating borrow status, or creating books also propagate to every other connected admin session

## Goals

The realtime dashboard implementation was introduced to solve the following problems:

- Keep all open admin dashboard sessions synchronized
- Avoid stale dashboard widgets after mutations
- Reuse the existing dashboard data queries instead of duplicating query logic in the WebSocket layer
- Preserve the current 3000ms stat-change experience in `Statistics.tsx`
- Limit sensitive data exposure by sending refresh signals over WebSocket and serving actual dashboard data through an authenticated HTTP endpoint

## High-Level Architecture

The system is split into four parts:

1. WebSocket server startup
2. Mutation-triggered broadcasts
3. Authenticated dashboard snapshot retrieval
4. Client-side realtime subscription and delayed refresh

### Data Flow

```text
Mutation happens
  -> server action completes database update
  -> server broadcasts "dashboard:refresh" to connected WebSocket clients
  -> each admin client waits 3000ms
  -> each admin client requests a fresh dashboard snapshot from /api/admin/dashboard
  -> dashboard widgets re-render with updated data
```

### Why Broadcast a Refresh Signal Instead of Full Data?

The WebSocket payload intentionally stays small and non-sensitive.

Instead of sending raw dashboard data over the socket, the server sends a simple refresh event:

```json
{
  "type": "dashboard:refresh",
  "timestamp": "2026-03-31T12:34:56.789Z"
}
```

The client then fetches the latest dashboard snapshot from an authenticated API route. This gives the implementation a few advantages:

- Keeps WebSocket messages lightweight
- Centralizes authorization in one HTTP route
- Reuses existing database query functions
- Avoids keeping dashboard data serialization logic inside the socket server

## Files Involved

### Core Realtime Files

- `instrumentation.ts`
  - Starts the WebSocket server when the Node.js runtime boots
- `lib/admin/realtime/dashboardSocketServer.ts`
  - Creates the singleton `WebSocketServer`
  - Broadcasts refresh events to all connected clients
- `lib/admin/realtime/useAdminDashboardRealtime.ts`
  - Custom client hook that manages the WebSocket connection, reconnect logic, and delayed refetch
- `app/api/admin/dashboard/route.ts`
  - Returns the latest admin dashboard snapshot
  - Restricts access to authenticated admins only
- `components/admin/dashboard/AdminDashboardRealtime.tsx`
  - Client-side dashboard wrapper that consumes the realtime hook

### Supporting Dashboard Files

- `lib/admin/stats.ts`
  - Provides `getAdminDashboardSnapshot()`
- `lib/admin/dashboardStatUtil.ts`
  - Stores the shared 3000ms delay constant
  - Builds the WebSocket URL on the client
- `app/admin/page.tsx`
  - Uses the snapshot loader and renders the realtime wrapper

### Updated Dashboard Widgets

- `components/admin/dashboard/Statistics.tsx`
- `components/admin/dashboard/account/AccountRequests.tsx`
- `components/admin/dashboard/borrow/BorrowRequests.tsx`
- `components/admin/dashboard/recent/RecentBooks.tsx`

These components now participate in the realtime flow through the wrapper and shared hook.

### Broadcast Trigger Points

The following server actions now notify connected admin dashboards after successful mutations:

- `lib/actions/auth.ts`
  - New user sign-up
- `lib/actions/book.ts`
  - User borrow request submission
- `lib/admin/actions/book.ts`
  - Create, update, delete book
- `lib/admin/actions/borrow.ts`
  - Update borrow status
  - Clear borrow records
- `lib/admin/actions/user.ts`
  - Approve account
  - Reject account
  - Delete user
  - Update user role

## Connection Lifecycle

### 1. Server Startup

The WebSocket server is started from `instrumentation.ts`.

This file runs at application startup in the Node.js runtime and calls:

```ts
ensureAdminDashboardSocketServer();
```

The socket server listens on a dedicated port rather than attaching to a Next.js route handler.

### 2. WebSocket Server Creation

`lib/admin/realtime/dashboardSocketServer.ts` creates a singleton `WebSocketServer` and stores it on `globalThis`.

This singleton pattern prevents repeated server creation during development reloads or repeated imports.

The server:

- Listens on `127.0.0.1` (loopback only, not binding on external interface)
- Uses the configured dashboard WebSocket port
- Sends a lightweight `dashboard:connected` message to newly connected clients
- Broadcasts `dashboard:refresh` events to all connected clients

### 2.1 WebSocket Connection Security and Access Controls

The socket server implements a strict access policy in `lib/admin/realtime/dashboardSocketServer.ts`:

- `ipAllowed` check: only `127.0.0.1`, `::1` or `0:0:0:0:0:0:0:1` are accepted
- `origin` check: if `ADMIN_DASHBOARD_WS_ORIGINS` is set it validates the request origin before accepting
- Browser admin pages from an allowed origin can connect without manually sending a secret
- `ADMIN_DASHBOARD_WS_SECRET` is still supported for non-browser clients via `x-admin-dashboard-secret`, `?admin_ws_secret=...`, or `Authorization: Bearer <secret>`
- Rejects with WebSocket close code `1008` and logs warnings for rejected attempts

This procedure is intended to keep the dedicated dashboard socket signaling channel constrained to trusted local admin tooling or proxy front-ends and avoid unauthorized third-party connections.

### 3. Client Subscription

`useAdminDashboardRealtime()` opens one WebSocket connection per admin dashboard page.

The hook:

- Connects to the dashboard socket server
- Listens for `dashboard:refresh` messages
- Debounces updates for 3000ms
- Fetches fresh data from `/api/admin/dashboard`
- Reconnects automatically if the socket closes

### 4. Snapshot Refresh

The snapshot API route returns:

```ts
{
  success: boolean;
  data: {
    stats: {
      totalBooks: number;
      totalUsers: number;
      borrowedBooks: number;
    };
    latestBorrowRequests: [...];
    latestAccountRequests: [...];
    recentBooks: [...];
  };
}
```

This response is used to re-render:

- Statistics
- Borrow Requests
- Account Requests
- Recently Added Books

## Why the Delay Is 3000ms

The dashboard already had a 3000ms stats update behavior before WebSockets were introduced.

To keep the UX consistent, the realtime system reuses the same delay value through:

- `DASHBOARD_REALTIME_DELAY_MS` in `lib/admin/dashboardStatUtil.ts`

This means:

- Incoming socket updates do not instantly snap the UI
- Stats continue showing the change indicator for the same duration
- List widgets and stats refresh on the same timing window

## Authentication and Security Model

### API Route Protection

The authenticated data fetch happens through:

- `GET /api/admin/dashboard`

This route:

- Calls `auth()`
- Verifies the user is authenticated
- Verifies `session.user.role === "ADMIN"`
- Returns `401 Unauthorized` for non-admin access

### WebSocket Security Boundary

The WebSocket server currently broadcasts only refresh notifications, not raw admin data.

That means the WebSocket channel itself is treated as a low-sensitivity signaling layer.

Important implications:

- Sensitive dashboard data is not sent over the socket
- Actual dashboard data remains behind the authenticated API route
- Even if a client reached the socket directly, it would still need admin authorization to fetch the snapshot data

If stricter socket-level access control is needed later, token-based socket authentication can be added on top of the current design.

## Environment and Port Configuration

The WebSocket server uses:

- `NEXT_PUBLIC_ADMIN_DASHBOARD_WS_PORT`

If this variable is not provided, it defaults to:

```text
3001
```

### Important Deployment Note

Because the `ws` server runs on a dedicated port, the deployment environment must allow that port to be opened and reached by admin clients.

This is especially important when deploying behind:

- Reverse proxies
- Container platforms
- Managed platforms with fixed exposed ports

If the environment cannot expose a second port, this implementation will need to be adapted to a different transport model.

## Snapshot Composition

The dashboard snapshot is built in `lib/admin/stats.ts` via:

- `getDashboardStats()`
- `getDashboardData()`
- `getAdminDashboardSnapshot()`

`getAdminDashboardSnapshot()` combines:

- Total books
- Total approved users
- Total currently borrowed books
- Latest pending borrow requests
- Latest pending account requests
- Recently added books

This keeps the refresh contract centralized and makes the dashboard API easier to maintain.

## Component Integration

### `app/admin/page.tsx`

The admin page now fetches the initial snapshot on the server and passes it into:

- `AdminDashboardRealtime`

This preserves a strong first render while still enabling client-side live updates afterward.

### `components/admin/dashboard/AdminDashboardRealtime.tsx`

This wrapper:

- Receives the initial snapshot
- Calls `useAdminDashboardRealtime(initialSnapshot)`
- Passes the live snapshot data down to the dashboard widgets

This ensures there is only one socket connection for the dashboard page instead of a separate connection per widget.

### Dashboard Widgets

The dashboard widgets remain focused on presentation:

- `Statistics.tsx`
- `BorrowRequests.tsx`
- `AccountRequests.tsx`
- `RecentBooks.tsx`

The state synchronization logic is intentionally kept outside them.

## Broadcast Events by Use Case

### When a user signs up

Source:

- `lib/actions/auth.ts`

Why admins should refresh:

- A new pending account request may appear

### When a user requests a book

Source:

- `lib/actions/book.ts`

Why admins should refresh:

- A new borrow request may appear
- Book copy availability changed server-side

### When an admin creates, updates, or deletes a book

Source:

- `lib/admin/actions/book.ts`

Why admins should refresh:

- Total books may change
- Recently added books may change

### When an admin updates borrow status or clears records

Source:

- `lib/admin/actions/borrow.ts`

Why admins should refresh:

- Borrow requests list may change
- Borrowed books stat may change

### When an admin approves, rejects, deletes, or changes a user role

Source:

- `lib/admin/actions/user.ts`

Why admins should refresh:

- Account requests may change
- Total users stat may change

## Reconnect Behavior

The client hook attempts to reconnect automatically when the socket closes.

Current reconnect strategy:

- Wait 2000ms
- Attempt to reconnect

This is intentionally simple and suitable for local or small-scale deployments.

If the application grows, this can be upgraded to:

- Exponential backoff
- Jitter
- Connection health tracking
- Visibility-aware reconnect logic

## Failure Modes and Expected Behavior

### If the WebSocket server is unavailable

Expected result:

- The dashboard still renders using the initial server snapshot
- Realtime updates stop working
- Manual refresh still works

### If the admin dashboard API route returns `401`

Expected result:

- The client skips applying new snapshot data
- The dashboard does not update from realtime fetches

### If a broadcast occurs during reconnect

Expected result:

- That specific event may be missed
- The next successful mutation or manual refresh will restore consistency

This tradeoff is acceptable for the dashboard because the server remains the source of truth.

## Troubleshooting

### Realtime updates are not arriving

Check:

- The app started in Node.js runtime
- `instrumentation.ts` is being executed
- Port `3001` or your configured socket port is open
- The browser can reach `ws://<host>:3001` or `wss://<host>:3001`

### Dashboard loads, but never refreshes after a mutation

Check:

- The mutation path calls `broadcastAdminDashboardUpdate()`
- The mutation completed successfully
- The browser console shows an open WebSocket connection
- `/api/admin/dashboard` returns a valid snapshot for the admin session

### Dashboard refreshes, but data looks stale

Check:

- The underlying query functions return the expected database records
- The mutation committed database changes before broadcasting
- The dashboard API route is not returning fallback values due to an internal error

### The WebSocket server throws a startup error

Check:

- Another process is not already using the configured port
- The platform allows binding to that port
- The environment variable value is valid

## Debugging Tips

### Browser-side

Inspect:

- Network tab
- WebSocket frames
- Calls to `/api/admin/dashboard`
- Console logs for socket parse or refresh errors

### Server-side

Inspect:

- Startup logs from `instrumentation.ts`
- Errors emitted by `dashboardSocketServer.ts`
- Errors from dashboard query functions in `lib/admin/stats.ts` and `lib/admin/dashboard.ts`

## Current Limitations

- The WebSocket server uses a dedicated port instead of sharing the main Next.js port
- Socket-level authentication is not enforced yet
- A missed broadcast can occur during temporary disconnects
- The system refreshes the full dashboard snapshot even when only one section changed

These are acceptable tradeoffs for the current dashboard-focused implementation because they keep the system simple and reliable.

## Possible Future Improvements

- Add authenticated WebSocket handshakes
- Move from full-snapshot refreshes to section-based refresh events
- Add heartbeat and stale-connection cleanup
- Add exponential reconnect backoff
- Surface connection state in the admin UI
- Support a production reverse-proxy upgrade path for WebSocket traffic

## Schema Impact

No database schema changes were required for this feature.

The realtime layer works entirely at the application level and reuses existing dashboard queries and server actions.

## Summary

The realtime admin dashboard implementation uses a clean signal-and-refresh model:

- Mutations broadcast a lightweight WebSocket event
- Admin clients receive the event
- Clients wait 3000ms
- Clients fetch an authenticated fresh snapshot
- All dashboard widgets update together

This keeps the implementation simple, secure enough for the current use case, and easy to extend in the future.
