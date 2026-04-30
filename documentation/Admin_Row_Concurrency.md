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
   - Lock lifecycle management
   - Version-based update validation
   - Conflict detection and reporting

2. **Client-side Hook** (`lib/admin/realtime/concurrency/useRowLock.ts`)
   - Lock display UI
   - Heartbeat maintenance (refresh lock every 20s)
   - TTL sweep for expired locks
   - SSE event handling

3. **API Endpoints**
   - `GET /api/admin/locks?entity=X&ids=Y,Z` – fetch current locks
   - `POST /api/admin/locks` – acquire lock
   - `PATCH /api/admin/locks` – release lock
   - `GET /api/admin/sync` – re-sync locks + rows after reconnect

4. **Event Types** (`lib/admin/realtime/concurrency/adminRealtimeEvents.ts`)
   - `LOCK_ACQUIRED` – admin locked a row
   - `LOCK_RELEASED` – lock expired or was released
   - `kind: "lock"` – SSE event structure

## Error Handling

### LockOwnershipError Class

**NEW**: Type-safe error for lock conflicts:

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

- `"lock_expired"` – Lock doesn't exist or expired
- `"lock_conflict"` – Lock held by another admin

### assertLockOwnership Updates

Now throws typed errors:

```typescript
export const assertLockOwnership = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string,
  token?: string,
): Promise<AdminRowLock> => {
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
  if (token && lock.token !== token) {
    throw new LockOwnershipError(
      "Your editing session expired. Please reopen and try again.",
      "lock_expired",
    );
  }
  return lock;
};
```

### API Route Pattern

All admin routes now catch lock errors early:

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
  // ... business logic ...

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

## Data Model

### Lock Structure

```typescript
type AdminRowLock = {
  entity: AdminRealtimeEntity; // "books" | "users" | "borrow_requests" | "account_requests"
  entityId: string; // row ID
  adminId: string; // user.id of admin holding lock
  adminName: string; // admin's display name
  expiresAt: string; // ISO timestamp when lock expires
  token: string; // random token for release verification
};
```

### Lock Storage

Locks are stored in Redis with keys: `lock:{entity}:{entityId}`

```
lock:books:550e8400-e29b-41d4-a716-446655440000
→ {"adminId":"...", "adminName":"Jane Admin", "expiresAt":"2026-04-29T10:20:00Z", "token":"a1b2c3..."}
```

**TTL**: 60 seconds (auto-expires in Redis)

## Lifecycle

### 1. Acquiring a Lock

When an admin opens an edit form for a row:

```typescript
export const acquireLock = async (
  entity: AdminRealtimeEntity, // e.g., "books"
  entityId: string, // row ID
  admin: AdminActor, // { id, name }
  token?: string,
): Promise<{ acquired: boolean; lock: AdminRowLock | null }> => {
  // Generate new lock with 60s TTL
  const lock = {
    entity,
    entityId,
    adminId: admin.id,
    adminName: admin.name,
    expiresAt: new Date(Date.now() + ROW_LOCK_TTL_MS).toISOString(),
    token: token || generateRandomToken(),
  };

  // Use Lua script for atomic compare-and-set
  const result = await redis.eval(
    `
    local current = redis.call('GET', KEYS[1])
    local next = ARGV[1]
    local ttl = tonumber(ARGV[2])
    local adminId = ARGV[3]

    if not current then
      -- Lock is free, acquire it
      redis.call('SET', KEYS[1], next, 'PX', ttl)
      return next
    end

    local decoded = cjson.decode(current)
    if decoded.adminId == adminId then
      -- Same admin can re-acquire (refresh TTL)
      redis.call('SET', KEYS[1], next, 'PX', ttl)
      return next
    end

    -- Different admin holds lock
    return current
    `,
    [getLockKey(entity, entityId)],
    [JSON.stringify(lock), String(ROW_LOCK_TTL_MS), admin.id],
  );

  const resolvedLock = parseLock(result, entity, entityId);
  const acquired = resolvedLock?.adminId === admin.id;

  if (acquired) {
    // Broadcast LOCK_ACQUIRED event to all admins
    await publishLockEvent(entity, entityId, resolvedLock);
  }

  return { acquired, lock: resolvedLock };
};
```

**Key Points**:

- Same admin can re-acquire their own lock (refresh TTL)
- Different admin cannot steal lock
- Returns `{ acquired: boolean, lock: current holder info }`

### 2. Heartbeat (Refresh Lock)

Every 20 seconds while an edit form is open:

```typescript
export const ROW_LOCK_HEARTBEAT_MS = 20_000;
```

Client code calls `acquireLock()` again with the same `token` to refresh the 60-second TTL.

**Benefits**:

- Active edits never expire
- Abandoned forms time out after 60s
- Prevents stale locks from blocking other admins

### 3. Releasing a Lock

When an admin closes an edit form or saves changes:

```typescript
export const releaseLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId?: string,
  token?: string,
): Promise<{ released: boolean; lock: AdminRowLock | null }> => {
  const result = await redis.eval(
    `
    local current = redis.call('GET', KEYS[1])
    if not current then
      return ''  -- lock already gone
    end

    local decoded = cjson.decode(current)

    -- Check ownership: adminId and token must match
    if ARGV[1] ~= '' and decoded.adminId ~= ARGV[1] then
      return current
    end

    if ARGV[2] ~= '' and decoded.token ~= ARGV[2] then
      return current
    end

    redis.call('DEL', KEYS[1])
    return '__deleted__'
    `,
    [getLockKey(entity, entityId)],
    [adminId ?? "", token ?? ""],
  );

  if (result === "__deleted__") {
    // Broadcast LOCK_RELEASED event
    await publishLockEvent(entity, entityId, null);
    return { released: true, lock: null };
  }

  return { released: false, lock: parseLock(result, entity, entityId) };
};
```

**Verification**:

- Only the lock owner (by adminId + token) can release
- Prevents accidental/malicious unlock by other admins

### 4. Conflict Detection on Save

When saving changes, the server uses version-based conflict detection:

```typescript
export const updateWithVersionCheck = async <TTable>({
  table,
  idColumn,
  versionColumn,
  id,
  expectedVersion,
  values,
}: UpdateWithVersionCheckArgs<TTable>) => {
  const result = await db
    .update(table)
    .set({
      ...values,
      updatedAt: new Date(),
      version: sql`${versionColumn} + 1`, // increment version
    })
    .where(
      and(
        eq(idColumn, id),
        eq(versionColumn, expectedVersion), // check version matches
      ),
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

1. Admin loads row with version `v=5`
2. Admin makes edits locally (version still `v=5`)
3. Admin clicks Save
4. Server tries `UPDATE ... WHERE version = 5 AND id = X` + `SET version = 6`
5. If another admin updated the row (now at v=6), the WHERE fails → error
6. Admin sees: "Update skipped — newer changes detected"

## Client-Side Hook

### useRowLock

```typescript
export const useRowLock = ({
  entity,          // "books" | "users" | ...
  rowIds,          // [id1, id2, ...] currently visible rows
  currentAdminId,  // admin's user ID
}: UseRowLockOptions)
```

**Responsibilities**:

1. **Fetch Locks on Mount/Resync**

   ```typescript
   const fetchLocks = async () => {
     const params = new URLSearchParams({ entity });
     if (rowIds.length > 0) {
       params.set("ids", rowIds.join(","));
     }
     const res = await fetch(`/api/admin/locks?${params}`);
     const data = await res.json();
     setLocks(data.locks); // { [id]: AdminRowLock | null }
   };
   ```

2. **Listen for Lock Events**

   ```typescript
   onMessage((event: MessageEvent) => {
     const parsed = JSON.parse(event.data) as AdminRealtimeEvent;
     if (parsed.kind === "lock" && parsed.entity === entity) {
       // Update local lock state
       setLocks((prev) => ({
         ...prev,
         [parsed.entityId]: parsed.lock,
       }));
     }
   });
   ```

3. **TTL Sweep (every 10s)**

   ```typescript
   const sweep = () => {
     setLocks((prev) => {
       const cleaned = { ...prev };
       for (const [id, lock] of Object.entries(cleaned)) {
         if (lock && new Date(lock.expiresAt) < new Date()) {
           delete cleaned[id]; // remove expired lock
         }
       }
       return cleaned;
     });
   };
   ```

4. **Heartbeat When Editing**
   ```typescript
   if (activeRowId) {
     const heartbeat = setInterval(async () => {
       const { acquired, lock } = await acquireLock(entity, activeRowId, {
         acquired: true,
         lock,
       });
       const { acquired, lock } = await acquireLock(
         entity,
         activeRowId,
         currentAdmin,
         currentLock?.token,
       );
     }, ROW_LOCK_HEARTBEAT_MS);
   }
   ```

### UI Display

The `RowLockIndicator` component shows lock status:

```typescript
<RowLockIndicator lock={locks[rowId]} />
// → "Currently being edited by Jane Admin" (with spinner)
```

## API Endpoints

### GET /api/admin/locks

Fetch locks for specific rows.

**Query Params**:

- `entity` (required): "books" | "users" | "borrow_requests" | "account_requests"
- `ids` (optional): comma-separated row IDs

**Response**:

```json
{
  "success": true,
  "locks": {
    "550e8400-e29b-41d4-a716-446655440000": {
      "entity": "books",
      "entityId": "550e8400-e29b-41d4-a716-446655440000",
      "adminId": "admin-123",
      "adminName": "Jane Admin",
      "expiresAt": "2026-04-29T10:20:00Z",
      "token": "a1b2c3..."
    },
    "550e8400-e29b-41d4-a716-446655440001": null
  }
}
```

### POST /api/admin/locks

Acquire a lock for editing a row.

**Request Body**:

```json
{
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "a1b2c3..." // optional, for refresh
}
```

**Response on Success**:

```json
{
  "success": true,
  "acquired": true,
  "lock": { ... }
}
```

**Response on Lock Held by Other Admin**:

```json
{
  "success": true,
  "acquired": false,
  "lock": {
    "adminName": "John Admin",
    "expiresAt": "2026-04-29T10:20:00Z",
    ...
  }
}
```

### PATCH /api/admin/locks

Release a lock.

**Request Body**:

```json
{
  "entity": "books",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "a1b2c3..."
}
```

**Response**:

```json
{
  "success": true,
  "released": true
}
```

## Error Handling

### Lock Ownership Verification

```typescript
export const assertLockOwnership = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string,
  token?: string,
): Promise<AdminRowLock> => {
  const lock = await getRowLock(entity, entityId);

  if (!lock || lock.adminId !== adminId || (token && lock.token !== token)) {
    throw new Error(
      lock
        ? lock.adminId !== adminId
          ? `Currently being edited by ${lock.adminName}`
          : "Your editing session expired. Please reopen and try again."
        : "This session expired. Please reopen the action.",
    );
  }

  return lock;
};
```

Thrown before any database mutation to prevent conflicts.

### Version Conflict Detection

When update fails due to version mismatch:

```
throw new Error(CONFLICT_ERROR_MESSAGE);
// "Update skipped — newer changes detected"
```

Admin must refresh the form and try again.

## Realtime Events

### Lock Events

When a lock is acquired or released, an event is broadcast to all connected admins:

```typescript
type AdminRealtimeLockEvent = {
  kind: "lock";
  channel: "locks";
  type: "LOCK_ACQUIRED" | "LOCK_RELEASED";
  entity: AdminRealtimeEntity;
  entityId: string;
  id: string;
  adminName?: string;
  lock: AdminRowLock | null;
  publishedAt: string;
};
```

Example: Admin Jane acquires a lock on book ID 123

```json
{
  "kind": "lock",
  "channel": "locks",
  "type": "LOCK_ACQUIRED",
  "entity": "books",
  "entityId": "123",
  "id": "123",
  "adminName": "Jane Admin",
  "lock": {
    "entity": "books",
    "entityId": "123",
    "adminId": "admin-456",
    "adminName": "Jane Admin",
    "expiresAt": "2026-04-29T10:20:00Z",
    "token": "abc..."
  },
  "publishedAt": "2026-04-29T10:00:00Z"
}
```

All other admin sessions receive this event and update their UI to show "Jane Admin" is editing row 123.

## Security Model

1. **Authentication**: Lock operations require `session.user.role === "ADMIN"`
2. **Lock Ownership**: Only the admin who acquired a lock can release it (checked via adminId + token)
3. **Version Validation**: Database mutations fail if the row was updated since initial load
4. **Token Secrecy**: Tokens are generated randomly and stored in Redis (not exposed to other admins)
5. **TTL Protection**: Locks auto-expire after 60s to prevent deadlock if a tab crashes

## Troubleshooting

### Lock shows for a deleted row

- The TTL sweep runs every 10s on the client to clean up expired locks
- If a row is deleted and recreated with the same ID, the old lock may briefly appear
- Refresh the page to force a sync

### "Currently being edited by" message won't go away

- Check the lock's `expiresAt` timestamp – may still be valid
- Force refresh: Close browser dev tools (to disconnect) and refresh page
- Check Redis directly: `redis-cli get lock:entity:id`

### Admin can't save despite no lock showing

- A different admin may have acquired the lock between page load and save
- Version conflict detection may have triggered
- Refresh the form and try again

## Related Files

- [lib/realtime/realtimeClient.ts](../lib/realtime/realtimeClient.ts) – Singleton SSE client
- [lib/admin/realtime/concurrency/useRealtimeCore.ts](../lib/admin/realtime/concurrency/useRealtimeCore.ts) – Connection lifecycle hook
- [lib/admin/realtime/concurrency/useRowLock.ts](../lib/admin/realtime/concurrency/useRowLock.ts) – Lock subscription hook
- [components/admin/shared/RowLockIndicator.tsx](../components/admin/shared/RowLockIndicator.tsx) – UI component
- [app/api/admin/locks/route.ts](../app/api/admin/locks/route.ts) – API endpoints
