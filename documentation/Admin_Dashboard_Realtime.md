# Admin Dashboard Realtime Updates

## Overview

The admin dashboard now uses Upstash Redis pub/sub plus a Next.js App Router Server-Sent Events (SSE) stream.

This implementation provides:

- realtime refresh signaling across deployed app instances
- one Redis subscription per app instance, not one per connected admin
- an authenticated stream on the main app origin
- a shared `3000ms` delayed refresh window so the dashboard remains visually stable
- a signal-and-refresh model where the snapshot API remains the source of truth

## Related Documentation

For admin row-level realtime features (row locking, CREATE/UPDATE/DELETE events), see:

- [Realtime Client SSE](Realtime_Client_SSE.md) – Singleton EventSource connection lifecycle
- [Admin Row Concurrency](Admin_Row_Concurrency.md) – Optimistic row locking with version conflict detection
- [Admin Realtime Events](Admin_Realtime_Events.md) – Event types, channels, and encoding
- [Admin Realtime API Routes](Admin_Realtime_API_Routes.md) – SSE stream and sync endpoints
- [Realtime Hooks](Realtime_Hooks.md) – `useRealtimeCore`, `useRowLock`, `useRealtimeUpdates`, `useOptimisticUpdate`

## Goals

The realtime layer is designed to:

- keep all open admin dashboard sessions synchronized
- avoid stale dashboard widgets after mutations
- reuse the existing dashboard queries instead of pushing full dashboard payloads through the realtime transport
- preserve the current `3000ms` stat-change experience in `Statistics.tsx`
- support internet-facing deployment without a localhost-only websocket server

## High-Level Architecture

The system is split into five parts:

1. mutation-triggered Redis publish
2. per-instance realtime broker
3. authenticated SSE stream route
4. client-side delayed refresh hook
5. authenticated dashboard snapshot retrieval

### Data Flow

```text
Mutation happens
  -> server action completes database update
  -> server publishes "dashboard:refresh" to Upstash Redis
  -> each app instance broker receives the event through one shared Redis subscription
  -> the broker fans the event out to all connected admin SSE clients on that instance
  -> each admin client waits 3000ms
  -> each admin client requests a fresh dashboard snapshot from /api/admin/dashboard
  -> dashboard widgets re-render with updated data
```

## Files Involved

- `lib/admin/realtime/dashboardRealtimeEvents.ts`
  - shared channel name, message types, retry/keepalive values, and SSE helpers
- `lib/admin/realtime/dashboardRedisPubSub.ts`
  - low-level Upstash Redis publish/subscribe helpers
- `lib/admin/realtime/dashboardRealtimeBroker.ts`
  - per-instance broker that multiplexes one Redis subscription to many connected admin streams
- `app/api/admin/dashboard/realtime/route.ts`
  - authenticated SSE endpoint for admin dashboard refresh signals
- `lib/admin/realtime/useAdminDashboardRealtime.ts`
  - client hook that opens the SSE stream, waits 3000ms, and fetches a fresh snapshot
- `app/api/admin/dashboard/route.ts`
  - returns the latest admin dashboard snapshot
- `lib/admin/realtime/dashboardSocketServer.ts`
  - compatibility wrapper that keeps `broadcastAdminDashboardUpdate()` as the mutation-facing helper
- `instrumentation.ts`
  - no longer boots a dedicated realtime socket server

## Per-Instance Fanout Optimization

The broker in `lib/admin/realtime/dashboardRealtimeBroker.ts` is the main scalability improvement.

Without the broker:

- every connected admin stream would create its own Redis subscription

With the broker:

- the first connected admin on an app instance starts one Redis subscription
- additional admins on the same instance register local listeners only
- one incoming Redis message is fanned out in memory to every local admin stream
- when the last admin disconnects, the Redis subscription is cleaned up after a short idle timeout

This keeps Redis subscription counts much lower while preserving horizontal scalability across multiple deployed instances.

## Connection Lifecycle

### 1. Mutation Broadcast

Any server action that changes dashboard-relevant data calls:

```ts
broadcastAdminDashboardUpdate();
```

That helper now publishes a refresh signal to Upstash Redis.

### 2. App Instance Broker

Each Node.js app instance keeps a singleton broker in memory that:

- stores active local listeners
- ensures only one Redis subscription exists per instance
- fans received events out to all connected local admin streams
- tears down the Redis subscription after the instance becomes idle

### 3. Authenticated SSE Stream

`GET /api/admin/dashboard/realtime`:

- calls `auth()`
- verifies `session.user.role === "ADMIN"`
- opens an SSE stream on the same app origin
- sends an initial `dashboard:connected` event
- keeps the connection alive with periodic SSE comments

### 4. Client Subscription

`useAdminDashboardRealtime()` opens one `EventSource` connection per admin dashboard page.

The hook:

- connects to `/api/admin/dashboard/realtime`
- listens for `dashboard:refresh`
- waits 3000ms
- fetches fresh data from `/api/admin/dashboard`
- reconnects automatically if the stream drops

## Authentication and Security Model

- `GET /api/admin/dashboard` and `GET /api/admin/dashboard/realtime` both require an authenticated `ADMIN` session
- Redis and SSE carry refresh notifications only, not raw admin dashboard data
- the snapshot API remains the source of truth

## Environment Configuration

The current realtime setup requires:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

The old dedicated websocket variables are no longer required for this dashboard flow:

- `NEXT_PUBLIC_ADMIN_DASHBOARD_WS_PORT`
- `NEXT_PUBLIC_ADMIN_DASHBOARD_WS_URL`
- `ADMIN_DASHBOARD_WS_SECRET`
- `ADMIN_DASHBOARD_WS_ORIGINS`

## Failure Modes

### If Redis is unavailable

- the dashboard still renders using the initial server snapshot
- realtime refresh signaling stops working temporarily
- manual refresh still works

### If a broadcast occurs during reconnect

- that specific event may be missed
- the next successful mutation or manual refresh will restore consistency

## Troubleshooting

### Realtime updates are not arriving

Check:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are valid
- the mutation path still calls `broadcastAdminDashboardUpdate()`
- the browser network tab shows an open request to `/api/admin/dashboard/realtime`
- `/api/admin/dashboard` returns a valid snapshot for the admin session

### Redis usage looks higher than expected

Check:

- how many deployed app instances are live
- whether your hosting platform is keeping idle instances warm

The broker reduces subscriptions per instance, not across the entire deployment.

## Summary

The realtime admin dashboard implementation now uses a scalable signal-and-refresh model:

- mutations publish a lightweight Redis event
- each app instance keeps one shared Redis subscription
- local brokers fan the event out to connected admin streams
- admin clients receive the SSE event
- clients wait 3000ms
- clients fetch an authenticated fresh snapshot
- all dashboard widgets update together

This is a much better fit for a real internet-facing Next.js App Router deployment than the previous localhost-only standalone websocket server.
