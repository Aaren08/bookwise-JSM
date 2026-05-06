# Admin Session Invalidation System

## Overview

This system provides **real-time session invalidation** for admin users. When an admin's role is revoked (downgraded to `USER`), they are automatically signed out and redirected — no waiting for their JWT to expire naturally.

It works via **Server-Sent Events (SSE)**: each active admin browser tab holds an open connection to the server, which pushes an invalidation event the moment a role change is published to Redis.

---

## Architecture

```
Role change action
      │
      ▼
publishRoleChangeEvent()          ← roleChangePublisher.ts
      │  (Redis pub/sub)
      ▼
/api/admin/session/realtime       ← route.ts
      │  (SSE stream, per admin tab)
      ▼
useSessionInvalidation()          ← useSessionInvalidation.ts
      │  (React hook in every admin page)
      ▼
signOut() + redirect /sign-in
```

---

## Files

| File | Role |
|---|---|
| `migrations/0008_role_session_versioning.sql` | DB migration — adds `session_version` column |
| `lib/admin/realtime/session/roleChangePublisher.ts` | Server-side: publishes role change events to Redis |
| `app/api/admin/session/realtime/route.ts` | SSE endpoint: streams events to connected admin clients |
| `lib/admin/realtime/session/useSessionInvalidation.ts` | Client-side hook: listens for events and signs out |
| `components/admin/SessionGuard.tsx` | React component wrapper that mounts the hook |

---

## Database

**Migration:** `migrations/0008_role_session_versioning.sql`

```sql
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
```

A `session_version` integer is added to each user row. It is incremented every time an admin's role changes. The current version is embedded in the user's JWT at sign-in time.

When the server pushes an invalidation event, it includes the new `sessionVersion`. The client compares this against its token's version — if the token is behind, the session is stale and the user is signed out.

---

## Redis Publisher

**File:** `lib/admin/realtime/session/roleChangePublisher.ts`

### Channel

```
admin:role-change
```

All role-change events are broadcast on this single Redis pub/sub channel. The SSE route filters events by `userId` server-side so each connection only acts on its own events.

### `RoleChangeEvent` type

```ts
type RoleChangeEvent = {
  userId: string;
  newRole: "USER" | "ADMIN";
  sessionVersion: number;  // the version the DB was bumped TO
  publishedAt: string;     // ISO timestamp
};
```

### `publishRoleChangeEvent(payload)`

Call this from any server action or API route that changes a user's role. It appends `publishedAt` and publishes the JSON-encoded event to Redis.

```ts
await publishRoleChangeEvent({
  userId: "user_abc",
  newRole: "USER",
  sessionVersion: 2,
});
```

### `isRoleChangeEvent(value)`

A type guard that validates an unknown value is a well-formed `RoleChangeEvent`. Used in the SSE route to safely parse incoming Redis messages.

---

## SSE Route

**File:** `app/api/admin/session/realtime/route.ts`

`GET /api/admin/session/realtime`

### Access control

- Requires an authenticated session with `role === "ADMIN"`.
- Returns `403 Forbidden` immediately if the user is not an active admin. The client treats a 403 as a redirect signal.

### Stream lifecycle

| Timer | Value | Purpose |
|---|---|---|
| Keepalive interval | 25 seconds | Sends SSE comment (`: keepalive`) to prevent proxy timeouts |
| Max lifetime | 5 minutes | Forces a clean reconnect cycle; sends `session:reconnect` before closing |

### Event types sent to client

| Event type | When sent | Client action |
|---|---|---|
| `session:connected` | On stream open | Reset reconnect backoff |
| `session:invalidated` | Role change detected for this user | Sign out + redirect |
| `session:reconnect` | Max lifetime reached | Reconnect immediately |
| `session:error` | Redis subscription error | Reconnect with backoff |

### Invalidation logic

The route only acts on a Redis message if **both** conditions are true:

1. `parsed.userId === userId` — the event is for this specific user.
2. `parsed.sessionVersion > tokenVersion` — the token is stale (the DB has moved ahead).

This makes the check idempotent: a repeated or out-of-order event won't trigger a spurious sign-out.

### Cleanup

A shared `cleanup()` function (guarded by a `closed` flag) handles teardown — clearing timers and unsubscribing from Redis — regardless of whether the stream ends due to client disconnect, max lifetime, or an error.

---

## Client Hook

**File:** `lib/admin/realtime/session/useSessionInvalidation.ts`

### `useSessionInvalidation()`

A React hook that manages an `EventSource` connection to the SSE endpoint. Mount it in any admin layout or page via `<SessionGuard />`.

### Reconnection strategy

| Scenario | Reconnect delay |
|---|---|
| `session:connected` received | Resets backoff to 3 seconds |
| `session:reconnect` received | Immediately (0 ms delay) |
| Connection error (`onerror`) | Exponential backoff: 3 s → 6 s → 12 s … capped at 30 s |

### Cleanup

On component unmount, the hook closes the `EventSource` and cancels any pending reconnect timer. A `destroyedRef` flag prevents reconnects after unmount.

---

## SessionGuard Component

**File:** `components/admin/SessionGuard.tsx`

A minimal client component that mounts `useSessionInvalidation()`. It renders nothing to the DOM — it exists solely to run the hook in the React tree.

```tsx
// Add to any admin layout:
<SessionGuard />
```

---

## Security Notes

- **Version comparison, not just role check** — using `sessionVersion` prevents replay attacks and handles race conditions where the event arrives before the cookie is cleared.
- **Server-side user filtering** — events are filtered by `userId` on the server before being sent down the wire; clients never see another user's invalidation events.
- **Immediate 403 on demoted admins** — if a demoted admin somehow reaches the endpoint after demotion (e.g. lingering tab), they receive a 403 and no stream is opened.
- **`server-only` guard** — `roleChangePublisher.ts` is marked `import "server-only"` to prevent accidental inclusion in client bundles.
