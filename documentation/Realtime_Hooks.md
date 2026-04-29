# Admin Realtime Hooks

## Overview

Four React hooks manage the client-side realtime admin dashboard experience:

1. **`useRealtimeCore`** – Connection lifecycle and reference counting
2. **`useRowLock`** – Row lock subscription and display
3. **`useRealtimeUpdates`** – Row-level CREATE/UPDATE/DELETE events
4. **`useOptimisticUpdate`** – Helper for optimistic state mutations

## Hook: useRealtimeCore

Connection lifecycle management with reference counting.

### Purpose

- Opens/closes the singleton EventSource based on mount count
- Allows multiple tables (BorrowTable, UserTable, AccountTable) to coexist
- Detects reconnects and triggers state resync
- Exposes connection status to consumers

### Signature

```typescript
function useRealtimeCore({ onResync }: UseRealtimeCoreOptions = {}): {
  status: "connected" | "reconnecting" | "stale" | "disconnected";
};
```

### Parameters

- **`onResync`**: Callback invoked after every reconnect or on periodic 60s resync
  - Called when status transitions from `"reconnecting"` → `"connected"`
  - Can be async; the hook debounces it (5s minimum between calls)
  - Should re-fetch rows, locks, or other state

### Return Value

- **`status`**: Current connection status

### Usage Example

```typescript
export function BorrowTable() {
  const [rows, setRows] = useState<BorrowRecord[]>([]);

  const handleResync = async () => {
    // Re-fetch first page of borrow records
    const res = await fetch("/api/admin/sync?entity=borrow_requests&includeRows=true");
    const data = await res.json();
    setRows(data.rows);
  };

  const { status } = useRealtimeCore({ onResync: handleResync });

  return (
    <div>
      <div className="connection-badge">
        Status: {status}
      </div>
      {/* table content */}
    </div>
  );
}
```

### How Reference Counting Works

```typescript
let mountCount = 0;

export function useRealtimeCore({ onResync }: UseRealtimeCoreOptions = {}) {
  useEffect(() => {
    // Mount: increment count
    mountCount += 1;
    connect();

    return () => {
      // Unmount: decrement count
      mountCount -= 1;
      if (mountCount <= 0) {
        disconnect();
      }
    };
  }, []);
}
```

**Scenario**: Three tables mounted simultaneously

```
BorrowTable mounts      → mountCount = 1 → EventSource opens
UserTable mounts        → mountCount = 2 → (no-op, already open)
AccountTable mounts     → mountCount = 3 → (no-op, already open)

AccountTable unmounts   → mountCount = 2 → (no-op, others still mounted)
UserTable unmounts      → mountCount = 1 → (no-op, BorrowTable still mounted)
BorrowTable unmounts    → mountCount = 0 → EventSource closes
```

### Resync Debouncing

The hook debounces `onResync` to prevent duplicate calls:

```typescript
const RESYNC_DEBOUNCE_MS = 5_000;

const safeResync = async () => {
  const now = Date.now();
  if (
    isResyncingRef.current ||
    now - lastResyncRef.current < RESYNC_DEBOUNCE_MS
  ) {
    return; // Skip if already resyncing or last resync was <5s ago
  }

  isResyncingRef.current = true;
  lastResyncRef.current = now;

  try {
    await onResyncRef.current?.();
  } finally {
    isResyncingRef.current = false;
  }
};
```

**Why?**

- Multiple events might fire during reconnect (heartbeat + periodic resync)
- Debouncing prevents hammering the server with duplicate sync requests

### Resync Triggers

`onResync` is called:

1. **On reconnect**: When status changes from `"reconnecting"` → `"connected"`
2. **Periodic safety**: Every 60 seconds (via `onPeriodicResync` listener)

## Hook: useRowLock

Manages row-level optimistic locks for editing.

### Purpose

- Fetches current locks for visible rows
- Listens for lock acquisition/release events
- Refreshes locks every 20s while editing (heartbeat)
- Cleans up expired locks every 10s (TTL sweep)
- Displays lock indicator UI

### Signature

```typescript
function useRowLock({
  entity: AdminRealtimeEntity;
  rowIds: string[];
  currentAdminId: string;
}): {
  locks: Record<string, AdminRowLock | null>;
  activeRowId: string | null;
  setActiveRowId: (id: string | null) => void;
}
```

### Parameters

- **`entity`**: One of `"books"`, `"users"`, `"borrow_requests"`, `"account_requests"`
- **`rowIds`**: IDs of rows currently visible on page (for lock fetching)
- **`currentAdminId`**: Admin's user ID (for lock ownership checks)

### Return Value

- **`locks`**: Map of row IDs to lock info (or null if unlocked)
- **`activeRowId`**: Currently editing row (or null)
- **`setActiveRowId`**: Set which row is being edited (triggers heartbeat)

### Usage Example

```typescript
export function BookRow({ book }: { book: Book }) {
  const [isEditing, setIsEditing] = useState(false);
  const { locks, activeRowId, setActiveRowId } = useRowLock({
    entity: "books",
    rowIds: [book.id],
    currentAdminId: session!.user.id,
  });

  const handleEdit = async () => {
    const { acquired } = await acquireLock("books", book.id);
    if (!acquired) {
      alert("Row is locked by another admin");
      return;
    }
    setIsEditing(true);
    setActiveRowId(book.id);
  };

  const lock = locks[book.id];

  return (
    <div>
      <RowLockIndicator lock={lock} />
      {!lock && (
        <button onClick={handleEdit}>Edit</button>
      )}
    </div>
  );
}
```

### Lifecycle

#### 1. Initial Fetch

On mount or when `rowIds` changes:

```typescript
useEffect(() => {
  const fetchLocks = async () => {
    const params = new URLSearchParams({ entity });
    if (rowIds.length > 0) {
      params.set("ids", rowIds.join(","));
    }
    const res = await fetch(`/api/admin/locks?${params}`);
    const data = await res.json();
    setLocks(data.locks);
  };

  fetchLocks();
}, [rowIds]);
```

#### 2. Event Listening

Listens for lock events via SSE:

```typescript
useEffect(() => {
  const unsubscribe = onMessage((event: MessageEvent) => {
    const parsed = JSON.parse(event.data) as AdminRealtimeEvent;

    if (parsed.kind === "lock" && parsed.entity === entity) {
      setLocks((prev) => ({
        ...prev,
        [parsed.entityId]: parsed.lock,
      }));
    }
  });

  return () => unsubscribe();
}, [entity]);
```

#### 3. TTL Sweep (every 10s)

Removes expired locks from local state:

```typescript
useEffect(() => {
  const sweep = setInterval(() => {
    setLocks((prev) => {
      const cleaned = { ...prev };
      for (const [id, lock] of Object.entries(cleaned)) {
        if (lock && new Date(lock.expiresAt) < new Date()) {
          delete cleaned[id]; // lock expired
        }
      }
      return cleaned;
    });
  }, LOCK_TTL_SWEEP_MS);

  return () => clearInterval(sweep);
}, []);
```

#### 4. Heartbeat (every 20s while editing)

Keeps active lock fresh:

```typescript
useEffect(() => {
  if (!activeRowId) return;

  const heartbeat = setInterval(async () => {
    const { acquired, lock } = await acquireLock(entity, activeRowId, {
      acquired: true,
      lock,
    });
    // Server broadcasts LOCK_ACQUIRED event
    // Local listeners update lock state
  }, ROW_LOCK_HEARTBEAT_MS);

  return () => clearInterval(heartbeat);
}, [activeRowId]);
```

#### 5. Resync After Reconnect

Re-fetches locks for currently tracked rows:

```typescript
useEffect(() => {
  const unsubscribe = useRealtimeCore({
    onResync: async () => {
      // Re-fetch locks after SSE reconnect
      const locks = await listRowLocks(entity, rowIds);
      setLocks(locks);
    },
  });

  return () => unsubscribe();
}, [entity, rowIds]);
```

## Hook: useRealtimeUpdates

Subscribes to row-level CREATE/UPDATE/DELETE events.

### Purpose

- Listens for row mutations (create, update, delete)
- Applies changes optimistically to local state
- Handles version conflicts (newer server data wins)
- Preserves row position when currently editing
- Removes rows that don't match filter

### Signature

```typescript
function useRealtimeUpdates<T extends IdentifiableRow>({
  entity: AdminRealtimeEntity;
  setItems: Dispatch<SetStateAction<T[]>>;
  sortFn?: (a: T, b: T, order: SortOrder) => number;
  sortOrder?: SortOrder;
  pinnedRowId?: string | null;
  matchesFilter?: (item: T) => boolean;
  onResync?: () => void | Promise<void>;
}): void
```

### Parameters

- **`entity`**: Entity channel to subscribe to
- **`setItems`**: State setter for the rows array
- **`sortFn`**: Custom sort comparator
- **`sortOrder`**: `"asc"` or `"desc"`
- **`pinnedRowId`**: Row ID to keep in its current position (being edited)
- **`matchesFilter`**: Predicate to check if row matches current filter
- **`onResync`**: Called after SSE reconnect

### Usage Example

```typescript
export function BorrowTable() {
  const [records, setRecords] = useState<BorrowRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleResync = async () => {
    const res = await fetch("/api/admin/sync?entity=borrow_requests&includeRows=true");
    const data = await res.json();
    setRecords(data.rows);
  };

  useRealtimeUpdates({
    entity: "borrow_requests",
    setItems: setRecords,
    sortFn: (a, b) => {
      // Sort by borrowDate descending
      return new Date(b.borrowDate).getTime() - new Date(a.borrowDate).getTime();
    },
    sortOrder: "desc",
    pinnedRowId: editingId,
    matchesFilter: (row) => row.status === "PENDING", // show only pending
    onResync: handleResync,
  });

  return (
    // table rendering
  );
}
```

### Event Handling

#### CREATE Event

```typescript
if (event.type === "CREATE") {
  // Check filter
  if (matchesFilterRef.current?.(eventData)) {
    // Add to items, sort
    setItemsRef.current((prev) => {
      const next = [...prev, eventData];
      if (sortFnRef.current) {
        next.sort((a, b) => sortFnRef.current(a, b, sortOrderRef.current));
      }
      return next;
    });
  }
}
```

#### UPDATE Event

```typescript
if (event.type === "UPDATE") {
  setItemsRef.current((prev) => {
    const index = prev.findIndex((item) => item.id === eventData.id);
    if (index === -1) return prev;

    const existing = prev[index];

    // Version conflict: server data is newer
    if (isServerRowNewer(eventData, existing)) {
      const next = [...prev];
      next[index] = eventData;
      return next;
    }

    // Local data is newer (being edited) — preserve local
    return prev;
  });
}
```

#### DELETE Event

```typescript
if (event.type === "DELETE") {
  setItemsRef.current((prev) =>
    prev.filter((item) => item.id !== eventData.id),
  );
}
```

### Smart Merge on Resync

When resync fetches fresh data:

```typescript
setItemsRef.current((previous) => {
  const incoming = payload.rows!;
  const incomingMap = new Map(incoming.map((r) => [r.id, r]));
  const previousIds = new Set(previous.map((r) => r.id));

  const next = previous
    .map((existing) => {
      const updated = incomingMap.get(existing.id);
      if (!updated) {
        // Was in our list, but not in sync → it's deleted
        return null;
      }

      if (isServerRowNewer(updated, existing)) {
        // Server is newer
        return updated;
      }
      // Local is newer (being edited)
      return existing;
    })
    .filter((item): item is T => item !== null);

  // Add any completely new rows
  for (const row of incoming) {
    if (!previousIds.has(row.id)) {
      next.push(row);
    }
  }

  // Re-sort
  if (sortFnRef.current) {
    next.sort((a, b) => sortFnRef.current(a, b, sortOrderRef.current));
  }

  // Preserve pinned row position
  return preservePinnedRowIndex(previous, next, pinnedRowIdRef.current);
});
```

## Hook: useOptimisticUpdate

Helper for optimistic mutations on rows.

### Purpose

- Apply mutations immediately (optimistically)
- Store previous state for rollback
- Revert on error

### Signature

```typescript
function useOptimisticUpdate<T extends Identifiable>(
  setItems: Dispatch<SetStateAction<T[]>>,
): {
  updateItem(id: string, updater: (item: T) => T): T | null;
  removeItem(id: string): T | null;
  restoreItem(item: T, index?: number): void;
};
```

### Parameters

- **`setItems`**: State setter for items array

### Return Value

- **`updateItem(id, updater)`**: Apply updater function to item, return previous
- **`removeItem(id)`**: Remove item, return previous
- **`restoreItem(item, index)`**: Add item back (optionally at specific index)

### Usage Example

```typescript
import { useOptimisticUpdate } from "@/lib/admin/realtime/concurrency/useOptimisticUpdate";

export function BorrowRow({ record, onDelete }: Props) {
  const [records, setRecords] = useState<BorrowRecord[]>([record]);
  const { removeItem, restoreItem } = useOptimisticUpdate(setRecords);

  const handleDelete = async () => {
    // Remove optimistically
    const previous = removeItem(record.id);

    try {
      await fetch(`/api/admin/records/${record.id}`, {
        method: "DELETE",
      });
      // Success — item stays removed
    } catch (error) {
      // Error — restore
      if (previous) {
        restoreItem(previous);
      }
      alert("Delete failed");
    }
  };

  return (
    <button onClick={handleDelete}>Delete</button>
  );
}
```

### Implementation

#### updateItem

```typescript
const updateItem = useCallback(
  (id: string, updater: (item: T) => T) => {
    let previousItem: T | null = null;

    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        previousItem = item;
        return updater(item);
      }),
    );

    return previousItem;
  },
  [setItems],
);
```

#### removeItem

```typescript
const removeItem = useCallback(
  (id: string) => {
    let previousItem: T | null = null;

    setItems((current) =>
      current.filter((item) => {
        if (item.id === id) {
          previousItem = item;
          return false;
        }
        return true;
      }),
    );

    return previousItem;
  },
  [setItems],
);
```

#### restoreItem

```typescript
const restoreItem = useCallback(
  (item: T, index?: number) => {
    setItems((current) => {
      const next = current.filter((entry) => entry.id !== item.id);

      if (typeof index === "number" && index >= 0 && index <= next.length) {
        next.splice(index, 0, item);
        return next;
      }

      return [...next, item];
    });
  },
  [setItems],
);
```

## Best Practices

### 1. Use useRealtimeCore in Table Components

```typescript
export function BorrowTable() {
  const [records, setRecords] = useState<BorrowRecord[]>([]);

  const { status } = useRealtimeCore({
    onResync: async () => {
      // Re-fetch current page
    },
  });

  // Other hooks
  useRealtimeUpdates({
    /* ... */
  });
}
```

### 2. Composition over Duplication

If you use both `useRealtimeUpdates` and `useRowLock`:

```typescript
export function BorrowTable() {
  const { status } = useRealtimeCore({ onResync: handleResync });

  useRealtimeUpdates({
    /* ... */
  });
  useRowLock({
    /* ... */
  });

  // Only ONE EventSource is open, despite THREE hooks
}
```

### 3. Handle Reconnects Gracefully

```typescript
const handleResync = async () => {
  try {
    const res = await fetch("/api/admin/sync?entity=...");
    const data = await res.json();
    setItems(data.rows);
  } catch (error) {
    console.error("Resync failed:", error);
    // Graceful fallback — keep local data until next retry
  }
};

useRealtimeCore({ onResync: handleResync });
```

### 4. Unblock Editing When Lock Expires

```typescript
const handleEdit = async () => {
  const { acquired, lock } = await acquireLock("books", rowId);

  if (!acquired && lock) {
    alert(`Locked by ${lock.adminName}`);
    return;
  }

  setIsEditing(true);
};
```

## Related Files

- [lib/realtime/realtimeClient.ts](../lib/realtime/realtimeClient.ts) – Singleton SSE client
- [lib/admin/realtime/concurrency/rowConcurrency.ts](../lib/admin/realtime/concurrency/rowConcurrency.ts) – Lock/event APIs
- [lib/admin/realtime/concurrency/adminRealtimeEvents.ts](../lib/admin/realtime/concurrency/adminRealtimeEvents.ts) – Event types
- [app/api/admin/realtime/rows/route.ts](../app/api/admin/realtime/rows/route.ts) – SSE stream
