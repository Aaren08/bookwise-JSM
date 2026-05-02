# Admin Realtime Hooks

## Overview

Four React hooks manage the client-side realtime admin dashboard experience:

1. **`useRealtimeCore`** – Connection lifecycle and reference counting
2. **`useRowLock`** – Row lock subscription, heartbeat, and full lock CRUD
3. **`useRealtimeUpdates`** – Row-level CREATE/UPDATE/DELETE events
4. **`useOptimisticUpdate`** – Helper for optimistic state mutations

---

## Hook: useRealtimeCore

Connection lifecycle management with reference counting.

### Purpose

- Opens/closes the singleton EventSource based on mount count
- Allows multiple tables (BorrowTable, UserTable, AccountTable) to coexist with one connection
- Detects reconnects and triggers state resync
- Exposes connection status to consumers

### Signature

```typescript
function useRealtimeCore({ onResync }: UseRealtimeCoreOptions = {}): {
  status: "connected" | "reconnecting" | "stale" | "disconnected";
};
```

### Parameters

- **`onResync`**: Async callback invoked after every reconnect or on periodic 60s resync. Debounced to at most once per 5 seconds to prevent hammering the server.

### Return Value

- **`status`**: Current connection status

### Usage Example

```typescript
export function BorrowTable() {
  const [rows, setRows] = useState<BorrowRecord[]>([]);

  const handleResync = async () => {
    const res = await fetch("/api/admin/sync?entity=borrow_requests&includeRows=true");
    const data = await res.json();
    setRows(data.rows);
  };

  const { status } = useRealtimeCore({ onResync: handleResync });

  return (
    <div>
      <div className="connection-badge">Status: {status}</div>
      {/* table content */}
    </div>
  );
}
```

### How Reference Counting Works

A module-level `mountCount` is shared across all instances:

```
BorrowTable mounts      → mountCount = 1 → EventSource opens
UserTable mounts        → mountCount = 2 → (no-op, already open)
AccountTable mounts     → mountCount = 3 → (no-op, already open)

AccountTable unmounts   → mountCount = 2 → (no-op, others still mounted)
UserTable unmounts      → mountCount = 1 → (no-op, BorrowTable still mounted)
BorrowTable unmounts    → mountCount = 0 → EventSource closes
```

### Resync Triggers

`onResync` is called in two situations:

1. **On reconnect**: When status transitions from `"reconnecting"` → `"connected"`
2. **Periodic safety**: Every 60 seconds via `onPeriodicResync` listener

Both paths go through `safeResync`, which enforces the 5s debounce.

---

## Hook: useRowLock

Manages row-level optimistic locks for editing, including heartbeat, TTL sweep, and post-reconnect resync.

### Signature

```typescript
function useRowLock({
  entity,
  rowIds,
  currentAdminId,
}: UseRowLockOptions): {
  locks: Record<string, AdminRowLock | null>;
  activeRowId: string | null;
  setActiveRowId: Dispatch<SetStateAction<string | null>>;
  acquireRowLock: (entityId: string) => Promise<{ success: boolean; lock?: AdminRowLock | null; message?: string }>;
  refreshRowLock: (entityId: string) => Promise<void>;
  releaseRowLock: (entityId: string) => Promise<{ success: boolean; reason: string }>;
  lockForRow: (entityId: string) => AdminRowLock | null;
  isLockedByOther: (entityId: string) => boolean;
  isLockedByCurrentAdmin: (entityId: string) => boolean;
};
```

### Parameters

| Param | Type | Description |
|-------|------|-------------|
| `entity` | `AdminRealtimeEntity` | Entity table to manage locks for |
| `rowIds` | `string[]` | IDs of rows currently visible (drives lock fetching scope) |
| `currentAdminId` | `string` | The current admin's `user.id` |

### Return Value

| Field | Description |
|-------|-------------|
| `locks` | Map of row ID → `AdminRowLock \| null` |
| `activeRowId` | Row currently being edited by this admin (or `null`) |
| `setActiveRowId` | Manual setter — rarely needed; prefer `acquireRowLock` |
| `acquireRowLock(id)` | POSTs to `/api/admin/locks`, sets `activeRowId` and stores token internally |
| `refreshRowLock(id)` | PATCHes `/api/admin/locks` with the current token (used internally by heartbeat) |
| `releaseRowLock(id)` | DELETEs from `/api/admin/locks` with optimistic local clear + rollback on failure |
| `lockForRow(id)` | Convenience selector — returns `locks[id] ?? null` |
| `isLockedByOther(id)` | `true` if lock exists and `adminId !== currentAdminId` |
| `isLockedByCurrentAdmin(id)` | `true` if lock exists and `adminId === currentAdminId` |

### Lifecycle

#### 1. Initial Lock Fetch

Fetches current lock state whenever `rowIds` changes:

```typescript
useEffect(() => {
  // GET /api/admin/locks?entity=X&ids=id1,id2,...
  const fetchLocks = async () => { ... };
  fetchLocks();
}, [entity, rowIdsString]);
```

#### 2. SSE Lock Event Listener

Handles `LOCK_ACQUIRED` and `LOCK_RELEASED` events for the relevant entity:

```typescript
onMessage((event: MessageEvent<string>) => {
  const parsed = JSON.parse(event.data) as AdminRealtimeEvent;
  if (parsed.kind !== "lock" || parsed.entity !== entity) return;

  if (parsed.type === "LOCK_RELEASED") {
    setLocks(prev => { const c = {...prev}; delete c[eventId]; return c; });
  } else {
    setLocks(prev => ({ ...prev, [eventId]: parsed.lock ?? null }));
  }
});
```

#### 3. TTL Sweep (every 10s)

Removes expired locks from local state to prevent ghost locks when `LOCK_RELEASED` events are missed during disconnects:

```typescript
setInterval(() => {
  setLocks(current => {
    const now = Date.now();
    const next = {...current};
    for (const [id, lock] of Object.entries(next)) {
      if (lock && new Date(lock.expiresAt).getTime() < now) {
        delete next[id];
      }
    }
    return next;
  });
}, LOCK_TTL_SWEEP_MS); // 10,000ms
```

#### 4. Heartbeat (every 20s while editing)

Keeps the active lock's Redis TTL alive while an edit form is open:

```typescript
useEffect(() => {
  if (!activeRowId) return;
  const interval = setInterval(() => {
    void refreshRowLock(heartbeatRowIdRef.current!);
  }, ROW_LOCK_HEARTBEAT_MS); // 20,000ms
  return () => clearInterval(interval);
}, [activeRowId, refreshRowLock]);
```

If the heartbeat PATCH fails (lock expired or stolen), the hook clears `activeRowId` and all token refs automatically.

#### 5. Post-Reconnect Resync

After SSE reconnects, re-fetches all locks via `GET /api/admin/sync`. Also validates the current active lock — if the server lock is gone or owned by a different token, local active state is cleared:

```typescript
onResync: async () => {
  const response = await fetch(`/api/admin/sync?entity=${entity}&ids=...`);
  const payload = await response.json();
  setLocks(payload.locks);

  // Verify active lock is still valid
  const serverLock = activeRowId ? payload.locks[activeRowId] : null;
  if (activeRowId && (!serverLock || serverLock.token !== activeTokenRef.current)) {
    setActiveRowId(null);
    activeTokenRef.current = null;
    // ...clear heartbeat refs
  }
}
```

#### 6. Auto-Clear on Lock Disappearance

Watches `locks[activeRowId]` — if it becomes `null` (due to TTL sweep, stolen lock, or SSE event), automatically clears `activeRowId`:

```typescript
useEffect(() => {
  if (activeRowId && locks[activeRowId] == null) {
    setActiveRowId(null);
    activeTokenRef.current = null;
    heartbeatRowIdRef.current = null;
    activeRowIdRef.current = null;
  }
}, [activeRowId, locks]);
```

### Optimistic Release with Rollback

`releaseRowLock` uses an optimistic-first strategy:

1. Capture the token ref before any state mutations
2. Stop the heartbeat loop immediately (clear `heartbeatRowIdRef`)
3. Optimistically clear the lock from local `locks` state
4. Send the DELETE to the server with the captured token
5. On failure (unless `reason === "already_gone"`): restore the lock, restore `activeRowId`, restore token refs
6. On success: clear the token ref (step deferred until after confirmed)

This ensures the UI feels instant while providing a safe rollback path.

### Usage Example

```typescript
export function BookTable({ books, session }: Props) {
  const visibleIds = useMemo(() => filteredBooks.map(b => b.id), [filteredBooks]);

  const {
    locks,
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
      toast.error(result.message ?? "Could not acquire lock");
    }
  };

  return filteredBooks.map(book => (
    <BookRow
      key={book.id}
      book={book}
      lock={locks[book.id]}
      isLockedByOther={isLockedByOther(book.id)}
      isLockedByCurrentAdmin={isLockedByCurrentAdmin(book.id)}
      onEdit={() => handleEdit(book.id)}
      onClose={() => releaseRowLock(book.id)}
    />
  ));
}
```

---

## Hook: useRealtimeUpdates

Subscribes to row-level CREATE/UPDATE/DELETE events from the singleton SSE client.

### Signature (current)

```typescript
type UseRealtimeUpdatesOptions<T extends IdentifiableRow> = {
  entity: AdminRealtimeEntity;
  items: T[];                             // REQUIRED — current list for ID tracking
  setItems: Dispatch<SetStateAction<T[]>>;
  sortFn?: (a: T, b: T, order: SortOrder) => number;
  sortOrder?: SortOrder;
  pinnedRowId?: string | null;
  matchesFilter?: (item: T) => boolean;
  onResync?: () => void | Promise<void>;
};
```

### Why `items` Is Required

The hook maintains a `currentIdsRef` that tracks which row IDs are currently visible. This ref is used during reconnect resync to know which rows to re-fetch, and is updated after every event. It is seeded from `items` on each render:

```typescript
useEffect(() => {
  currentIdsRef.current = items.map((item) => item.id);
}, [items]);
```

Without this, the resync would fetch an empty list and fail to re-hydrate rows after reconnect.

### Table Integration Pattern

```typescript
// Full sorted list drives realtimeUpdates (tracks ALL rows including off-screen)
const [sortedData, setSortedData] = useState<Book[]>(initialBooks);

// Filtered subset drives lock subscriptions (only visible rows)
const filteredData = useMemo(
  () => sortedData.filter(matchesFilter),
  [sortedData, matchesFilter],
);

useRealtimeUpdates({
  entity: "books",
  items: sortedData,          // full list — so resync re-fetches everything
  setItems: setSortedData,
  sortFn,
  sortOrder,
  pinnedRowId,
  matchesFilter,
  onResync: handleResync,
});

const { locks } = useRowLock({
  entity: "books",
  rowIds: filteredData.map(b => b.id),   // filtered list — reduces lock fetch scope
  currentAdminId: session.user.id,
});
```

### Event Handling

#### DELETE Event

```typescript
if (parsed.type === "DELETE") {
  next = previous.filter((item) => item.id !== parsed.entityId);
  const result = preservePinnedRowIndex(previous, next, pinnedRowId);
  currentIdsRef.current = result.map((r) => r.id);
  return result;
}
```

#### UPDATE / CREATE Event

1. If `data` is missing → skip
2. If existing row found and it is newer (locally) → skip (local wins)
3. If `matchesFilter` rejects the new data → remove row from list
4. If row exists and passes filter → replace in place
5. If row is new → append
6. Re-sort using `sortFn`
7. Preserve `pinnedRowId` position
8. Update `currentIdsRef`

### Smart Merge on Resync

After reconnect, `useRealtimeUpdates` calls `GET /api/admin/sync?entity=X&ids=...&includeRows=true` for currently tracked IDs and merges:

```typescript
const next = previous.map((existing) => {
  const updated = incomingMap.get(existing.id);
  if (!updated) return null;                          // row deleted → drop it
  if (isServerRowNewer(updated, existing)) return updated; // server newer → apply
  return existing;                                    // local newer → keep (being edited)
}).filter(Boolean);

// Add brand-new rows not in previous list
for (const row of incoming) {
  if (!previousIds.has(row.id)) next.push(row);
}

// Re-sort and preserve pinned row position
```

### Resync Coordination

`useRealtimeUpdates` calls `useRealtimeCore` internally with `handleResync` as the `onResync` callback. This means:

- The hook participates in reference counting (one more `mountCount` increment)
- Resync fires both when SSE reconnects and on the periodic 60s timer
- If both `useRealtimeUpdates` and `useRowLock` are used in the same component, `mountCount` will be 2, but only one `EventSource` is ever open

---

## Hook: useOptimisticUpdate

Helper for optimistic mutations with rollback.

### Signature

```typescript
function useOptimisticUpdate<T extends Identifiable>(
  setItems: Dispatch<SetStateAction<T[]>>,
): {
  updateItem: (id: string, updater: (item: T) => T) => T | null;
  removeItem: (id: string) => T | null;
  restoreItem: (item: T, index?: number) => void;
};
```

### Usage Pattern

```typescript
const { removeItem, restoreItem } = useOptimisticUpdate(setRecords);

const handleDelete = async () => {
  const previous = removeItem(record.id);  // returns previous state

  try {
    await fetch(`/api/admin/records/${record.id}`, { method: "DELETE" });
  } catch {
    if (previous) restoreItem(previous);   // rollback on error
    alert("Delete failed");
  }
};
```

### Methods

#### `updateItem(id, updater)`

Applies `updater` to the item with matching `id`. Returns the previous item (for rollback), or `null` if not found.

#### `removeItem(id)`

Removes the item with matching `id` from the list. Returns the removed item (for rollback), or `null` if not found.

#### `restoreItem(item, index?)`

Re-inserts an item. If `index` is provided and valid, inserts at that position; otherwise appends. First removes any existing item with the same `id` to avoid duplicates.

---

## Accessibility Improvements

### RowLockIndicator

The lock indicator is keyboard accessible and screen-reader friendly:

```typescript
<div
  className="row-lock_badge"
  tabIndex={0}
  role="img"
  aria-label={`Currently being edited by ${lock.adminName}`}
  title={`Currently being edited by ${lock.adminName}`}
>
  <span className="row-lock_icon-wrapper">
    <LoaderPinwheel className="size-3.5 animate-spin" />
  </span>
  <div className="row-lock_tooltip">
    Currently being edited by {lock.adminName}
  </div>
</div>
```

- `tabIndex={0}` – keyboard focusable
- `role="img"` – conveys visual status meaning
- `aria-label` – full text for screen readers
- `title` – hover tooltip matching the aria-label

---

## Lock Error Handling in Components

### HTTP 409 Conflict

Any endpoint that validates lock ownership returns `409 Conflict` on lock errors, with `{ error: string }` body:

```typescript
// In a form submit handler
const response = await fetch("/api/admin/borrow/approve", {
  method: "POST",
  body: JSON.stringify({ recordId, lockToken }),
});

if (response.status === 409) {
  const { error } = await response.json();
  toast.error(error); // "Currently being edited by Jane Admin"
  return;
}
```

### LockOwnershipError Codes

When using `assertLockOwnership` server-side, errors carry a `code`:

| Code | User-facing message |
|------|---------------------|
| `"lock_expired"` | "Your editing session expired. Please reopen and try again." |
| `"lock_conflict"` | "Currently being edited by \<name\>" |

---

## Best Practices

### Pass filtered items to `useRowLock`, full list to `useRealtimeUpdates`

```typescript
// Tracks ALL rows (including those not currently visible after filter)
useRealtimeUpdates({ entity: "users", items: sortedUsers, ... });

// Only fetches locks for currently visible rows
useRowLock({ entity: "users", rowIds: filteredUsers.map(u => u.id), ... });
```

This reduces lock-fetch traffic while keeping realtime updates accurate across filter changes.

### Always unsubscribe from listeners

```typescript
useEffect(() => {
  const unsub = onMessage(handler);
  return () => unsub();
}, []);
```

The hooks handle this internally — but if you call `onMessage` directly, always return the unsubscriber.

### Handle resync failures gracefully

```typescript
const handleResync = async () => {
  try {
    const res = await fetch("/api/admin/sync?...");
    const data = await res.json();
    if (data.success) setItems(data.rows);
  } catch {
    // Keep local state until next retry — don't throw
  }
};
```

### Composition: multiple hooks, one connection

```typescript
export function BookTable() {
  useRealtimeCore({ onResync: handleResync });   // mountCount = 1
  useRealtimeUpdates({ entity: "books", ... });  // mountCount = 2 (internal useRealtimeCore)
  useRowLock({ entity: "books", ... });          // mountCount = 3 (internal useRealtimeCore)
  // → still only ONE EventSource open
}
```

---

## Related Files

- [lib/realtime/realtimeClient.ts](../lib/realtime/realtimeClient.ts) – Singleton SSE client
- [lib/admin/realtime/concurrency/useRealtimeCore.ts](../lib/admin/realtime/concurrency/useRealtimeCore.ts)
- [lib/admin/realtime/concurrency/useRowLock.ts](../lib/admin/realtime/concurrency/useRowLock.ts)
- [lib/admin/realtime/concurrency/useRealtimeUpdates.ts](../lib/admin/realtime/concurrency/useRealtimeUpdates.ts)
- [lib/admin/realtime/concurrency/useOptimisticUpdate.ts](../lib/admin/realtime/concurrency/useOptimisticUpdate.ts)
- [lib/admin/realtime/concurrency/rowConcurrency.ts](../lib/admin/realtime/concurrency/rowConcurrency.ts)
- [app/api/admin/realtime/rows/route.ts](../app/api/admin/realtime/rows/route.ts)
