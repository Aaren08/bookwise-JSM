# Admin Row Concurrency Control

## Overview

The admin row concurrency system provides optimistic locking with conflict detection for admin dashboard tables. It prevents admins from overwriting each other's edits using:

- Redis-backed distributed locks with 60-second TTL
- Version-based conflict detection for database updates
- Real-time lock acquisition/release notifications via SSE
- Server-side authorization checks

## Architecture

### Components

1. **Server-side Lock Manager** (`lib/admin/realtime/concurrency/rowConcurrency.ts`)
   - Lock lifecycle management (acquire, heartbeat/refresh, release)
   - Version-based update validation
   - Conflict detection and reporting
   - Atomic Lua scripts for all Redis operations

2. **Client-side Hook** (`lib/admin/realtime/concurrency/useRowLock.ts`)
   - Full lock CRUD API (`acquireRowLock`, `refreshRowLock`, `releaseRowLock`)
   - Convenience selectors (`lockForRow`, `isLockedByOther`, `isLockedByCurrentAdmin`)
   - Optimistic lock release with rollback
   - Heartbeat maintenance (refresh lock every 20s)
   - TTL sweep for expired locks (every 10s)
   - SSE event handling

3. **API Endpoints**
   - `GET /api/admin/locks?entity=X&ids=Y,Z` – fetch current locks
   - `POST /api/admin/locks` – acquire a new lock
   - `PATCH /api/admin/locks` – heartbeat-only refresh (must include token)
   - `DELETE /api/admin/locks` – release a lock (token required)
   - `GET /api/admin/sync` – re-sync locks + rows after reconnect

4. **Event Types** (`lib/admin/realtime/concurrency/adminRealtimeEvents.ts`)
   - `LOCK_ACQUIRED` – admin locked a row
   - `LOCK_RELEASED` – lock expired or was released
   - `kind: "lock"` – SSE event structure

## Data Model

### Lock Structure

```typescript
type AdminRowLock = {
  entity: AdminRealtimeEntity; // "books" | "users" | "borrow_requests" | "account_requests"
  entityId: string;            // row ID
  adminId: string;             // user.id of admin holding lock
  adminName: string;           // admin's display name
  expiresAt: string;           // ISO timestamp when lock expires
  token: string;               // random token for release/heartbeat verification
  version: number;             // monotonically incremented on each heartbeat refresh
};
```

> **Note**: The `version` field on `AdminRowLock` is the lock's own internal version (incremented by every heartbeat), not the row's data version. It is checked by `isAdminRowLock` and must be present for a lock to be considered valid.

### Lock Storage

Locks are stored in Redis with keys: `lock:{entity}:{entityId}`

```
lock:books:550e8400-e29b-41d4-a716-446655440000
→ {"adminId":"...","adminName":"Jane Admin","expiresAt":"...","token":"a1b2c3...","version":3}
```

**TTL**: 60 seconds (auto-expires in Redis). The `version` field starts at `1` on first acquisition and increments by `1` on every heartbeat or re-entrant acquire.

## Error Handling

### LockOwnershipError Class

Type-safe error for lock conflicts:

```typescript
export class LockOwnershipError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "LockOwnershipError";
    this.code = code;
  }
}
```

**Error Codes**:

- `"lock_expired"` – Lock doesn't exist, token is missing, or token doesn't match
- `"lock_conflict"` – Lock held by another admin

### assertLockOwnership

Validates lock ownership before any mutation. Now guards on a missing token **before** hitting Redis:

```typescript
export const assertLockOwnership = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string,
  token?: string,
): Promise<AdminRowLock> => {
  // Fast-fail: no token means no valid session
  if (!token) {
    throw new LockOwnershipError(
      "Your editing session expired. Please reopen and try again.",
      "lock_expired",
    );
  }

  const lock = await getRowLock(entity, entityId);

  if (!lock) {
    throw new LockOwnershipError(
      "This session expired. Please reopen the action.",
      "lock_expired",
    );
  }
  if (lock.adminId !== adminId) {
    throw new LockOwnershipError(
      `Currently being edited by ${lock.adminName}`,
      "lock_conflict",
    );
  }
  if (lock.token !== token) {
    throw new LockOwnershipError(
      "Your editing session expired. Please reopen and try again.",
      "lock_expired",
    );
  }

  return lock;
};
```

### API Route Pattern

All admin routes catch lock errors early:

```typescript
try {
  await assertLockOwnership(
    "borrow_requests",
    recordId,
    session.user.id,
    body.lockToken,
  );
} catch (error) {
  if (error instanceof LockOwnershipError) {
    return NextResponse.json(
      { error: error.message },
      { status: 409 }, // Conflict
    );
  }
  throw error;
} finally {
  try {
    await releaseLock(
      "borrow_requests",
      recordId,
      session.user.id,
      body.lockToken,
    );
  } catch (lockError) {
    console.error("releaseLock failed best-effort cleanup", {
      recordId,
      lockToken: body.lockToken,
      error: lockError,
    });
  }
}
```

### Best-Effort Realtime Publishing

Realtime events are wrapped in try-catch to never block operations:

```typescript
let realtimeRecord: BorrowRecord | null = null;
try {
  realtimeRecord = await getBorrowRecordById(recordId);
  if (realtimeRecord) {
    await publishEvent("borrow_requests", {
      type: "UPDATE",
      entityId: recordId,
      data: realtimeRecord,
    });
  }
} catch (realtimeError) {
  console.error(
    `Failed to publish realtime update for record ${recordId}:`,
    realtimeError,
  );
}

// Return success regardless of realtime publishing
return NextResponse.json({
  success: true,
  data: realtimeRecord,
});
```

## Lifecycle

### 1. Acquiring a Lock

`acquireLock` uses an atomic Lua script (`ACQUIRE_SCRIPT`):

```typescript
export const acquireLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  admin: AdminActor,
  existingToken?: string,
): Promise<{ acquired: boolean; lock: AdminRowLock | null; blockedBy?: AdminRowLock | null }> => {
  const expiresAt = new Date(Date.now() + ROW_LOCK_TTL_MS).toISOString();
  const token = existingToken ?? Math.random().toString(36).slice(2);

  // ...runs ACQUIRE_SCRIPT via redis.eval...

  const resolvedLock = parseLock(result, entity, entityId);
  const acquired = resolvedLock?.adminId === admin.id;

  if (acquired) {
    await publishLockEvent(entity, entityId, resolvedLock).catch(console.error);
    return { acquired: true, lock: resolvedLock };
  }

  return { acquired: false, lock: null, blockedBy: resolvedLock };
};
```

**Return shape**:

| Field | Type | Meaning |
|-------|------|---------|
| `acquired` | `boolean` | Whether this admin now holds the lock |
| `lock` | `AdminRowLock \| null` | The current admin's lock (if `acquired: true`) |
| `blockedBy` | `AdminRowLock \| null` | The other admin's lock (if `acquired: false`) |

**Lua script behavior** (`ACQUIRE_SCRIPT`):

- If key is empty → acquire with 60s TTL, `version: 1`
- If corrupt JSON → overwrite and acquire
- If `decoded.adminId === adminId` → re-entrant: refresh TTL, keep same token, bump `version`
- If different admin → return current lock unchanged (caller sees `acquired: false`)

### 2. Heartbeat (Refresh Lock)

`refreshLock` is a dedicated heartbeat-only operation. It does NOT rotate the token:

```typescript
export const refreshLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string,
  token: string,
): Promise<boolean> => {
  const newExpiry = new Date(Date.now() + ROW_LOCK_TTL_MS).toISOString();
  const result = await redis.eval(HEARTBEAT_SCRIPT, [...], [...]);
  return result === 1;
};
```

**Lua script behavior** (`HEARTBEAT_SCRIPT`):

- Returns `0` if the lock doesn't exist
- Returns `0` if `adminId` or `token` don't match
- Otherwise: updates `expiresAt`, bumps `version`, resets Redis TTL, returns `1`

Called every `ROW_LOCK_HEARTBEAT_MS` (20s) from `PATCH /api/admin/locks`.

### 3. Releasing a Lock

`releaseLock` requires both `adminId` and `token` (neither is optional):

```typescript
export const releaseLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string,  // required
  token: string,    // required
): Promise<{ released: boolean; reason: string }> => {
  // Guards on empty strings before hitting Redis
  const result = await redis.eval(RELEASE_SCRIPT, [...], [...]);
  const [status, reason] = result as [string, string];
  const released = status === "OK";

  if (released) {
    await publishLockEvent(entity, entityId, null).catch(console.error);
  }

  return { released, reason };
};
```

**Return shape**:

| Field | Type | Meaning |
|-------|------|---------|
| `released` | `boolean` | Whether the lock was deleted |
| `reason` | `string` | Outcome code (see below) |

**`reason` codes from `RELEASE_SCRIPT`**:

| Reason | Meaning |
|--------|---------|
| `"released"` | Lock deleted successfully |
| `"already_gone"` | Lock didn't exist (already expired or released) |
| `"corrupt_deleted"` | Lock had corrupt JSON — deleted anyway |
| `"wrong_owner"` | `adminId` doesn't match current lock holder |
| `"token_mismatch"` | `token` doesn't match current lock |
| `"missing_identity"` | `adminId` or `token` was empty string — rejected |

**Lua script behavior** (`RELEASE_SCRIPT`):

- Rejects immediately if either `adminId` or `token` is empty (`missing_identity`)
- Returns `already_gone` if the key doesn't exist
- Deletes corrupt JSON and returns `corrupt_deleted`
- Returns `wrong_owner` if `adminId` doesn't match
- Returns `token_mismatch` if `token` doesn't match
- Deletes the key and returns `released` on success

### 4. Conflict Detection on Save

Version-based optimistic locking at the database layer:

```typescript
export const updateWithVersionCheck = async <TTable>({
  table, idColumn, versionColumn, id, expectedVersion, values,
}) => {
  const result = await db
    .update(table)
    .set({
      ...values,
      updatedAt: new Date(),
      version: sql`${versionColumn} + 1`,
    })
    .where(
      and(eq(idColumn, id), eq(versionColumn, expectedVersion)),
    )
    .returning();

  if (!result[0]) {
    throw new Error(CONFLICT_ERROR_MESSAGE);
    // "Update skipped — newer changes detected"
  }

  return result[0];
};
```

**Flow**:

1. Admin loads row with `version = 5`
2. Admin makes edits locally (row version still `5` locally)
3. Admin clicks Save — sends `expectedVersion: 5`
4. Server: `UPDATE ... WHERE version = 5 AND id = X SET version = 6`
5. If another admin already updated the row to `v=6`, the WHERE clause fails → no rows returned → `CONFLICT_ERROR_MESSAGE` thrown
6. Admin sees: "Update skipped — newer changes detected"

## Client-Side Hook: useRowLock

### Full API

```typescript
const {
  locks,                  // Record<string, AdminRowLock | null>
  activeRowId,            // string | null — row currently being edited
  setActiveRowId,         // manual setter (rarely needed directly)
  acquireRowLock,         // (entityId: string) => Promise<{ success, lock?, message? }>
  refreshRowLock,         // (entityId: string) => Promise<void>
  releaseRowLock,         // (entityId: string) => Promise<{ success, reason }>
  lockForRow,             // (entityId: string) => AdminRowLock | null
  isLockedByOther,        // (entityId: string) => boolean
  isLockedByCurrentAdmin, // (entityId: string) => boolean
} = useRowLock({ entity, rowIds, currentAdminId });
```

### Optimistic Lock Release with Rollback

`releaseRowLock` applies an optimistic local delete before the server DELETE, then rolls back if the server rejects:

```typescript
// 1. Capture token FIRST — before any state mutations
const tokenToRelease = activeTokenRef.current;

// 2. Stop the heartbeat loop immediately
heartbeatRowIdRef.current = null;
activeRowIdRef.current = null;

// 3. Optimistic local delete
const previousLock = locks[entityId];
setLocks(prev => { const c = {...prev}; delete c[entityId]; return c; });

// 4. Server DELETE
const response = await fetch("/api/admin/locks", { method: "DELETE", body: JSON.stringify({ entity, entityId, token: tokenToRelease }) });

// 5. Rollback on failure
if (!response.ok && payload.reason !== "already_gone") {
  setLocks(prev => ({ ...prev, [entityId]: previousLock }));
  if (previousLock?.adminId === adminIdToRelease) {
    setActiveRowId(entityId);
    activeTokenRef.current = tokenToRelease;
    heartbeatRowIdRef.current = entityId;
    activeRowIdRef.current = entityId;
  }
  return { success: false, reason: payload.reason ?? "server_error" };
}

// 6. Clear token ref only AFTER confirmed success
if (activeTokenRef.current === tokenToRelease) {
  activeTokenRef.current = null;
}
```

The token ref is intentionally not cleared until step 6 so that if the server rejects, the rollback can restore the full heartbeat state.

### Responsibilities

1. **Fetch Locks on Mount / Row ID Change**: Fetches current lock state for all visible row IDs via `GET /api/admin/locks`.

2. **Listen for Lock Events**: Handles `LOCK_ACQUIRED` and `LOCK_RELEASED` SSE events for the relevant entity.

3. **TTL Sweep (every 10s)**: Removes expired locks from local state to prevent ghost locks when `LOCK_RELEASED` events are missed during disconnects.

4. **Heartbeat (every 20s while editing)**: Calls `PATCH /api/admin/locks` to keep the Redis TTL alive while a row is being edited.

5. **Post-Reconnect Resync**: Re-fetches all locks for currently visible rows after SSE reconnects. Also validates that the active lock (if any) is still owned by the current admin with the same token — clears active state if not.

6. **Auto-clear on Lock Disappearance**: Watches `locks[activeRowId]` and clears `activeRowId` when it becomes `null` (TTL sweep, stolen by another admin, or SSE event).

### Usage Example

```typescript
export function BookTable({ books, session }: Props) {
  // Only pass visible (filtered) row IDs to reduce lock-fetch scope
  const visibleIds = useMemo(() => filteredBooks.map(b => b.id), [filteredBooks]);

  const {
    locks,
    activeRowId,
    acquireRowLock,
    releaseRowLock,
    isLockedByOther,
    isLockedByCurrentAdmin,
  } = useRowLock({
    entity: "books",
    rowIds: visibleIds,
    currentAdminId: session.user.id,
  });

  const handleEdit = async (bookId: string) => {
    const result = await acquireRowLock(bookId);
    if (!result.success) {
      // result.message will be e.g. "Row locked by Jane Admin"
      showError(result.message);
    }
  };

  return (
    <>
      {filteredBooks.map(book => (
        <BookRow
          key={book.id}
          book={book}
          lock={locks[book.id]}
          isLockedByOther={isLockedByOther(book.id)}
          isLockedByCurrentAdmin={isLockedByCurrentAdmin(book.id)}
          onEdit={() => handleEdit(book.id)}
          onClose={() => releaseRowLock(book.id)}
        />
      ))}
    </>
  );
}
```

## API Endpoints

### GET /api/admin/locks

Fetch locks for specific rows.

**Query Params**: `entity` (required), `ids` (optional comma-separated)

**Response**:

```json
{
  "success": true,
  "locks": {
    "550e8400-...": {
      "entity": "books",
      "entityId": "550e8400-...",
      "adminId": "admin-123",
      "adminName": "Jane Admin",
      "expiresAt": "2026-04-29T10:20:00Z",
      "token": "a1b2c3...",
      "version": 3
    },
    "550e8400-...1": null
  }
}
```

### POST /api/admin/locks

Acquire a lock.

**Request Body**: `{ entity, entityId, token? }`

**Response on Success** (`200`):

```json
{ "success": true, "lock": { ...AdminRowLock } }
```

**Response on Lock Held by Another Admin** (`409`):

```json
{
  "success": false,
  "message": "Row locked by John Admin",
  "lock": { ...John's AdminRowLock }
}
```

### PATCH /api/admin/locks

Heartbeat-only refresh. **Requires `token`** — will return `400` if token is missing.

**Request Body**: `{ entity, entityId, token }`

**Response on Success** (`200`): `{ "success": true }`

**Response on Failure** (`409`): `{ "success": false, "message": "Lock not owned or expired" }`

### DELETE /api/admin/locks

Release a lock. **Requires `token`** — will return `400` if token is missing.

**Request Body**: `{ entity, entityId, token }`

**Response on Success** (`200`):

```json
{
  "success": true,
  "reason": "released",
  "message": "Lock released"
}
```

**Response on Non-ownership** (`200`, but `success: false`):

```json
{
  "success": false,
  "reason": "wrong_owner",
  "message": "Lock not owned by current admin"
}
```

> **Breaking change from older docs**: The DELETE response uses `reason` (string), not `lock` (object). The `lock` field is no longer returned.

## Realtime Events

Lock events are published to all admins on acquire and release:

```typescript
type AdminRealtimeLockEvent = {
  kind: "lock";
  channel: "locks";
  type: "LOCK_ACQUIRED" | "LOCK_RELEASED";
  entity: AdminRealtimeEntity;
  entityId: string;
  id: string;
  adminName?: string;
  lock: AdminRowLock | null; // null on LOCK_RELEASED
  publishedAt: string;
};
```

## Security Model

1. **Authentication**: All lock operations require `session.user.role === "ADMIN"` via `requireAdminActor()`
2. **Lock Ownership**: Release requires both `adminId` and `token` to match — enforced in Lua script atomically
3. **Token Secrecy**: Tokens are random strings stored only in Redis; other admins cannot see them via SSE (they see the lock but not the token)
4. **Heartbeat Integrity**: Heartbeat script validates both `adminId` and `token` — cannot be called by non-owners
5. **TTL Protection**: Locks auto-expire after 60s to prevent deadlock if a tab crashes
6. **Empty-Guard**: Lua scripts reject empty `adminId` or `token` strings with `missing_identity` rather than silently matching

## Troubleshooting

### Lock shows "being edited" after the admin left

- TTL sweep runs every 10s on the client; wait up to 10s
- Redis TTL is 60s; without heartbeat the lock expires automatically
- Force refresh: `redis-cli GET lock:entity:id` to check the TTL
- Check `expiresAt` in the lock object shown in SSE events

### "Currently being edited by" message won't go away after 60s

- The admin's tab may still be open and heartbeating successfully
- Check `redis-cli TTL lock:entity:id` — if it keeps resetting, heartbeat is active
- Ask the other admin to close their edit form

### Admin can't save despite no lock showing

- Another admin may have acquired the lock between page load and save
- Version conflict detection may have triggered independently
- Check the HTTP response: `409` → lock conflict, `500` with "newer changes detected" → version conflict
- Refresh the form and try again

### PATCH heartbeat returning 409

- Lock has expired or the token changed (e.g., was re-acquired elsewhere)
- Client will clear local `activeRowId` and stop the heartbeat loop
- User must re-open the edit form to acquire a fresh lock

### Release returns `wrong_owner` or `token_mismatch`

- The lock was taken by another admin after the current session's lock expired
- The client optimistically clears the lock locally then rolls back on failure
- User will see their active state restored and a warning

## Related Files

- [lib/admin/realtime/concurrency/rowConcurrency.ts](../lib/admin/realtime/concurrency/rowConcurrency.ts) – Lock management logic
- [lib/admin/realtime/concurrency/adminRealtimeEvents.ts](../lib/admin/realtime/concurrency/adminRealtimeEvents.ts) – Event types and encoding
- [lib/admin/realtime/concurrency/useRowLock.ts](../lib/admin/realtime/concurrency/useRowLock.ts) – Client hook
- [lib/admin/realtime/concurrency/rowSyncFetchers.ts](../lib/admin/realtime/concurrency/rowSyncFetchers.ts) – Row fetching logic
- [app/api/admin/locks/route.ts](../app/api/admin/locks/route.ts) – API endpoints
- [components/admin/shared/RowLockIndicator.tsx](../components/admin/shared/RowLockIndicator.tsx) – UI component
