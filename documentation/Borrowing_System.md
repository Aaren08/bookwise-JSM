# Borrowing System

## Overview

BookWise models borrowing as a **reservation-first workflow**:

1. A user submits a borrow request — the system immediately reserves one copy by incrementing `reservedCount`.
2. An admin either approves the request (`BORROWED`) or rejects it (`REJECTED`).
3. When a borrowed book is returned, the record becomes `RETURNED` or `LATE_RETURN`.
4. Pending reservations that are never approved expire automatically after 15 minutes.

This design prevents overbooking under concurrent requests and keeps inventory consistent by deriving `availableCopies` from counters on the `books` table.

---

## Borrow Record Data Model

```typescript
interface BorrowRecord {
  id: string;
  userId: string;
  bookId: string;
  borrowDate: Date;       // Set to NOW() when request is approved (receipt generated)
  dueDate: string;        // Calculated from borrowDurationDays at approval time
  returnDate?: string | null;
  borrowStatus: BorrowStatus;
  reservedAt?: Date | null; // Set to NOW() when PENDING request is created
  dismissed: number;      // 0 = visible, 1 = hidden from user's history view
  createdAt: Date;
  version: number;        // Optimistic concurrency counter
}

type BorrowStatus =
  | "PENDING"      // Reserved copy; awaiting admin approval
  | "BORROWED"     // Admin approved; book physically checked out
  | "RETURNED"     // Returned on or before dueDate
  | "LATE_RETURN"  // Returned after dueDate
  | "REJECTED";    // Rejected by admin, or reservation expired
```

### Key Field Notes

- **`reservedAt`** — set when the `PENDING` record is created. Used by the expiry cron to identify stale reservations. From the user's perspective this is when their request was submitted.
- **`borrowDate`** — set to `NOW()` when the admin generates a receipt (transitions `PENDING → BORROWED`). Not the same as `createdAt`.
- **`dueDate`** — calculated from the system-wide `borrowDurationDays` setting at the time of approval, not at request creation. Changing `borrowDurationDays` affects future approvals only.
- **`dismissed`** — soft-delete flag. Users can dismiss `RETURNED`, `LATE_RETURN`, and `REJECTED` records from their history without deleting the underlying data.
- **`version`** — incremented on every status transition. Prevents double-approve or double-return race conditions.

---

## Inventory Model

Borrowing does not mutate `availableCopies` directly. That column is a **generated stored column** computed by PostgreSQL as:

```
availableCopies = totalCopies - borrowedCount - reservedCount
```

| Counter | Tracks |
|---|---|
| `borrowedCount` | Active approved loans (`BORROWED`) |
| `reservedCount` | Pending requests holding a copy (`PENDING`) |
| `availableCopies` | Derived — never written by application code |

This makes availability deterministic and eliminates drift between counters and UI state.

---

## Borrow Request Lifecycle

### 1. User Creates a Request

Users request a book from the book detail page:

```typescript
await fetch("/api/book/requests", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bookId }),
});
```

**Server behavior (`POST /api/book/requests`):**

- Requires an authenticated, `APPROVED` user
- Rejects duplicate active (`PENDING` or `BORROWED`) requests for the same user and book
- Runs **lazy expiry** — scans for stale `PENDING` records older than 15 minutes for this book and rejects them, reclaiming their `reservedCount` slots before checking capacity
- Atomically increments `reservedCount` only when `reservedCount + borrowedCount < totalCopies`; returns `409` if at capacity
- Creates a `borrow_records` row with `borrowStatus = "PENDING"`, `reservedAt = NOW()`, and `dueDate = today + borrowDurationDays`
- Broadcasts a realtime book availability update and an admin dashboard refresh signal
- Publishes a `CREATE` event to the `borrow_requests` realtime channel

**Why `reservedCount` and not `borrowedCount`?**  
A `PENDING` request means the book is spoken for but has not physically left the library. `borrowedCount` is only incremented when the admin approves the request. This two-counter design accurately reflects both physical availability and committed capacity.

---

### 2. Admin Approves a Request

```
PATCH /api/book/requests/:id/approve
```

**Behavior:**

- Admin only; validates lock ownership via `assertLockOwnership()`
- Requires the record to currently be `PENDING`
- Uses a single CTE SQL statement (compatible with the Neon HTTP driver) to atomically:
  - Transition `PENDING → BORROWED`
  - Set `borrowDate = NOW()`
  - Recalculate `dueDate` from current `borrowDurationDays`
  - Decrement `reservedCount`
  - Increment `borrowedCount`
  - Increment record `version`
- Revalidates book and user caches
- Broadcasts dashboard and availability updates
- Publishes an `UPDATE` event to the `borrow_requests` realtime channel

---

### 3. Admin Rejects a Request

```
PATCH /api/book/requests/:id/reject
```

**Behavior:**

- Admin only; validates lock ownership
- Requires the record to currently be `PENDING`
- Atomically transitions `PENDING → REJECTED` and decrements `reservedCount`
- Broadcasts updated availability

---

### 4. User or Admin Returns a Book

```
PATCH /api/book/requests/:id/return
```

**Behavior:**

- Allowed for the borrowing user or any admin
- Requires the record to currently be `BORROWED`
- Compares `dueDate` with today:
  - On time → `RETURNED`
  - Overdue → `LATE_RETURN`
- Sets `returnDate = today`
- Atomically decrements `borrowedCount`
- Broadcasts updated availability

---

## Reservation Expiry

Pending requests expire after **15 minutes** of inactivity. Two mechanisms enforce this:

### Lazy Expiry (at Request Time)

When a user submits a new borrow request, the server first scans for stale `PENDING` records for that book (where `reservedAt < NOW() - 15 minutes`) and rejects them. The exact number of rows expired is used to reclaim the precise number of `reservedCount` slots before the availability check.

This ensures that stale reservations from other users never block a new request unnecessarily.

### Scheduled Cron Cleanup

```
GET /api/book/cron/expire-reservations
```

**Behavior:**

- Finds all `PENDING` borrow records where `reservedAt < NOW() - 15 minutes` across all books
- Bulk-transitions them to `REJECTED`
- Decrements `reservedCount` per affected book
- Revalidates caches
- Broadcasts inventory and dashboard updates

**Authorization:** If `CRON_SECRET` is configured in the environment, the request must include:

```
Authorization: Bearer <CRON_SECRET>
```

**Response:**

```json
{
  "success": true,
  "expired": 3,
  "affectedBooks": 2,
  "message": "Expired 3 stale reservation(s)."
}
```

---

## Eligibility Rules

Borrowing eligibility is evaluated by `getBorrowingEligibilityCached()` (defined in `lib/performance/cache.ts`) and cached with the `books` and `users` cache tags. It is revalidated after any borrow status change.

Checks (in order):

1. The user exists and is authenticated
2. The user `status` is `"APPROVED"`
3. The book exists
4. `availableCopies > 0`
5. The user has no existing `PENDING` or `BORROWED` record for this book

```typescript
type BorrowingEligibility = {
  isEligible: boolean;
  message: string;
};
```

Example messages:

- `"Book is not available at the moment. Please check back later."`
- `"You have already borrowed or requested this book."`
- `"You are not eligible to borrow this book. Please contact the library for more information."`

---

## Status Lifecycle

```
                    ┌─────────────────────────┐
                    │                         │
User submits ──→ PENDING ──→ BORROWED ──→ RETURNED
                    │            │
                    │            └──→ LATE_RETURN
                    │
                    └──→ REJECTED
                         (admin rejection or reservation expiry)
```

| Transition | Trigger | Counter change |
|---|---|---|
| `PENDING → BORROWED` | Admin approves | `reservedCount - 1`, `borrowedCount + 1` |
| `PENDING → REJECTED` | Admin rejects | `reservedCount - 1` |
| `PENDING → REJECTED` | Reservation expiry (lazy or cron) | `reservedCount - 1` |
| `BORROWED → RETURNED` | Returned on or before `dueDate` | `borrowedCount - 1` |
| `BORROWED → LATE_RETURN` | Returned after `dueDate` | `borrowedCount - 1` |

---

## Realtime Behavior

Every counter-changing operation publishes a `BOOK_UPDATED` event that includes the current inventory state:

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

Clients on the book detail page subscribe via `GET /api/book/stream?bookId=<id>` and update the displayed available count without a page reload.

Admin clients additionally receive row-level `UPDATE` events via `GET /api/admin/realtime/rows` that reflect status changes in the borrow records table in real time.

See [Book Availability Realtime](Book_Availability_Realtime.md) and [Admin Realtime Events](Admin_Realtime_Events.md) for full stream documentation.

---

## Admin UI Behavior

The `BorrowTable` component supports the full `BorrowStatus` set including `REJECTED` and explicit `LATE_RETURN` handling:

- Status changes are **optimistic** — the row updates immediately before server confirmation
- Rollback restores the previous row state on API failure or transition conflict
- Pending state is tracked **per row** so one in-flight request does not block the whole table
- Borrow rows are **memoized** to reduce full-table re-renders during individual status updates
- Invalid transitions are **filtered from the dropdown** rather than sent to the server and rejected

Status actions map to endpoints:

| Target status | Endpoint |
|---|---|
| `BORROWED` | `PATCH /api/book/requests/:id/approve` |
| `REJECTED` | `PATCH /api/book/requests/:id/reject` |
| `RETURNED` / `LATE_RETURN` | `PATCH /api/book/requests/:id/return` |

---

## Dismissing Records

Users can hide completed records (`RETURNED`, `LATE_RETURN`, `REJECTED`) from their profile view:

```
PUT /api/borrow-records/[id]/dismiss
```

This sets `dismissed = 1` on the record. The record is not deleted — it remains in the database for historical and audit purposes. The server verifies the calling user owns the record (or is an admin) before updating.

---

## Related Files

- `app/api/book/requests/route.ts`
- `app/api/book/requests/[id]/approve/route.ts`
- `app/api/book/requests/[id]/reject/route.ts`
- `app/api/book/requests/[id]/return/route.ts`
- `app/api/book/cron/expire-reservations/route.ts`
- `components/book/BorrowBook.tsx`
- `components/book/BookOverview.tsx`
- `components/admin/tables/BorrowTable.tsx`
- `lib/actions/book.ts` — `borrowBook()`, `dismissBorrowRecord()`
- `lib/admin/actions/borrow.ts` — admin borrow management
- `lib/admin/actions/receipt.ts` — `generateReceipt()` (also transitions PENDING → BORROWED)
- `lib/performance/cache.ts` — `getBorrowingEligibilityCached()`
- `database/schema.ts` — `borrow_records` table and `BORROW_STATUS_ENUM`
