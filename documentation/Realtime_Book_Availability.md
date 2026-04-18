# Realtime Book Availability

## Overview

The BookWise application features a Realtime Book Availability mechanism to instantly reflect the number of available copies across all connected clients. When an admin updates the status of a borrow request, connected user clients on the book details page react immediately without requiring manual refresh.

## Architecture

This feature rides on top of the same robust, Redis-backed pub/sub architecture used by the Admin Dashboard.

### 1. The Broker Pipeline

1. **Admin Action**: An admin alters a borrow request status (e.g. `PENDING` -> `BORROWED`) resulting in an inventory deduction.
2. **PostgreSQL Return**: The atomic SQL update utilizes a `.returning()` clause to pinpoint the exact new quantity of available copies.
3. **Redis Event Push**: A `BOOK_AVAILABILITY_UPDATED` message is dispatched to the centralized Redis pub/sub channel.

### 2. The SSE Distribution

Unlike dashboard signals, book availability notifications are pushed to the **public** Server-Sent Events (SSE) route at `/api/stream`.

- The public route leverages the `addAdminDashboardRealtimeListener` global setup securely.
- **Server-Side Filtering**: The route accepts an optional `bookId` query parameter. It strictly evaluates incoming messages and only calls `enqueue` for matching `BOOK_AVAILABILITY_UPDATED` events where the `bookId` matches the client's request. This prevents the server from beaming unnecessary data arrays into clients and prevents exposing unrelated dashboard analytics logic.

### 3. Security & Performance Constraints
To prevent Long-Lived Request Abuse, the pipeline includes immediate middleware defenses:
- **Rate-Limiting**: Connections fall under an Upstash Redis strict rate-limiter, keyed contextually by the `x-forwarded-for` client IP. Exceeding limits returns a `429 Too Many Requests`.
- **Max-Listeners**: The system tracks an `activeStreamListeners` global state integer, capping stream connections concurrently (currently configured to 100). If traffic saturates, requests are dropped cleanly. 

### 4. The Client Integration

`BookOverview.tsx` manages a dynamic `"use client"` lifecycle.

- When traversing the book details page, the browser mounts an `EventSource` attached to `/api/stream?bookId={id}`.
- A fast connection listens implicitly for targeted changes.
- **Granular Updates**: Only the component instance observing the modified book receives a React state update for `availableCopies`. This guarantees highly localized and performant UI modifications.
- Disconnections are gracefully managed with a retry interval.

## Extensibility

This system operates alongside `dashboardRealtimeEvents.ts` under `lib/admin/realtime/borrowBookRealtimeEvents.ts`. By isolating the feature context, we maintain high scalability for future public broadcast additions.
