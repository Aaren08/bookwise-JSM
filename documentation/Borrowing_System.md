# Borrowing System

## Overview

BookWise now models borrowing as a reservation-first workflow:

1. A user submits a borrow request.
2. The system reserves one copy immediately by incrementing `reservedCount`.
3. An admin either approves the request (`BORROWED`) or rejects it (`REJECTED`).
4. When a borrowed book is returned, the record becomes `RETURNED` or `LATE_RETURN`.

This design prevents overbooking during concurrent requests and keeps inventory consistent by deriving `availableCopies` from counters stored on the `books` table.

## Borrow Record Data Model

```typescript
interface BorrowRecord {
  id: string;
  userId: string;
  bookId: string;
  borrowDate: Date;
  dueDate: string;
  returnDate?: string | null;
  borrowStatus: BorrowStatus;
  reservedAt?: Date | null;
  dismissed: number;
  createdAt: Date;
}

type BorrowStatus =
  | "PENDING"
  | "BORROWED"
  | "RETURNED"
  | "LATE_RETURN"
  | "REJECTED";
```

## Inventory Model

Borrowing no longer mutates `availableCopies` directly. Instead:

```text
availableCopies = totalCopies - borrowedCount - reservedCount
```

- `reservedCount` tracks pending requests
- `borrowedCount` tracks approved active loans
- `availableCopies` is a generated database column

This makes availability deterministic and removes drift between counters and UI state.

## Borrow Request Flow

### 1. User creates a request

Users request a book from the book details page via `POST /api/book/requests`.

```typescript
await fetch("/api/book/requests", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bookId }),
});
```

Server behavior:

- Requires an authenticated, `APPROVED` user
- Rejects duplicate active requests for the same user and book
- Lazily expires stale `PENDING` reservations older than 15 minutes
- Reclaims `reservedCount` using the exact number of rows expired in that request
- Atomically increments `reservedCount` only when capacity exists
- Creates a `borrow_records` row with:
  - `borrowStatus = "PENDING"`
  - `reservedAt = now`
  - `dueDate = today + 14 days`
- Broadcasts a realtime book availability update

### 2. Admin approves a request

Admins approve pending requests through `PATCH /api/book/requests/:id/approve`.

Behavior:

- Requires `ADMIN`
- Only succeeds when the record is still `PENDING`
- Transitions `PENDING -> BORROWED`
- Uses a single SQL statement on Neon HTTP so the record update and counter swap stay atomic without `db.transaction()`
- Atomically updates counters:
  - `reservedCount -= 1`
  - `borrowedCount += 1`
- Revalidates cached book and user data
- Broadcasts admin dashboard and book availability updates

### 3. Admin rejects a request

Admins reject pending requests through `PATCH /api/book/requests/:id/reject`.

Behavior:

- Requires `ADMIN`
- Only succeeds when the record is still `PENDING`
- Transitions `PENDING -> REJECTED`
- Uses a single SQL statement on Neon HTTP so the status update and reserved slot release happen together
- Releases the reserved slot by decrementing `reservedCount`
- Broadcasts updated availability

### 4. User or admin returns a borrowed book

Returns are processed through `PATCH /api/book/requests/:id/return`.

Behavior:

- Allowed for the borrowing user or an admin
- Only succeeds when the record is currently `BORROWED`
- Compares `dueDate` to today
- Uses a single SQL statement on Neon HTTP for the status change and `borrowedCount` decrement
- Transitions:
  - `BORROWED -> RETURNED` when on time
  - `BORROWED -> LATE_RETURN` when overdue
- Sets `returnDate`
- Decrements `borrowedCount`
- Broadcasts updated availability

## Reservation Expiry

Pending requests expire after 15 minutes.

Two mechanisms enforce this:

1. Lazy expiry during new request creation
2. Scheduled cleanup at `GET /api/book/cron/expire-reservations`

The cron endpoint:

- Finds stale `PENDING` records where `reservedAt < now - 15 minutes`
- Bulk updates them to `REJECTED`
- Decrements `reservedCount` per affected book
- Revalidates caches
- Broadcasts inventory and dashboard updates

If `CRON_SECRET` is configured, the route requires:

```text
Authorization: Bearer <CRON_SECRET>
```

## Eligibility Rules

Borrowing eligibility is cached and currently checks:

1. The user exists
2. The book exists
3. `availableCopies > 0`
4. The user status is `APPROVED`
5. The user has no active `PENDING` or `BORROWED` record for that same book

Example return shape:

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

## Status Lifecycle

```text
PENDING -> BORROWED     (admin approval)
PENDING -> REJECTED     (admin rejection or reservation expiry)
BORROWED -> RETURNED    (returned on time)
BORROWED -> LATE_RETURN (returned after due date)
```

Notes:

- `PENDING` now represents an active reservation, not just an untracked request
- `REJECTED` is used for both manual rejection and automatic expiry cleanup
- Completed user history can still be dismissed with `dismissed = 1`

## Realtime Behavior

Borrowing operations publish book availability updates that include:

```typescript
{
  type: "BOOK_UPDATED";
  timestamp: string;
  bookId: string;
  availableCount: number;
  reservedCount: number;
  borrowedCount: number;
}
```

Clients on the book page subscribe through `/api/book/stream?bookId=<id>` and update the displayed available copies without a refresh.

## Admin UI Changes

The admin borrow table now supports the full status set, including `REJECTED` and explicit `LATE_RETURN` handling for borrowed records.

Status actions are mapped to request endpoints:

- `BORROWED` -> `PATCH /api/book/requests/:id/approve`
- `REJECTED` -> `PATCH /api/book/requests/:id/reject`
- `RETURNED` and `LATE_RETURN` -> `PATCH /api/book/requests/:id/return`

Recent UX improvements:

- Status changes are optimistic, so the row updates immediately before server confirmation
- Rollback restores the previous row state on API failure or transition conflict
- Pending state is tracked per row, so one request does not block the whole table
- Borrow rows are memoized to reduce full-table re-renders during status updates
- Invalid transitions are filtered in the dropdown instead of being sent to the server

## Related Files

- `app/api/book/requests/route.ts`
- `app/api/book/requests/[id]/approve/route.ts`
- `app/api/book/requests/[id]/reject/route.ts`
- `app/api/book/requests/[id]/return/route.ts`
- `app/api/book/cron/expire-reservations/route.ts`
- `components/book/BorrowBook.tsx`
- `components/book/BookOverview.tsx`
- `components/admin/tables/BorrowTable.tsx`
- `lib/actions/book.ts`
- `lib/admin/actions/borrow.ts`
