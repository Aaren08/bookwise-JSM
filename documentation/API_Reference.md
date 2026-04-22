# API Reference

## Overview

BookWise exposes authenticated Next.js route handlers for user, admin, and internal library workflows. The current uncommitted changes introduce a dedicated `/api/book/*` surface for borrow requests, realtime availability, and reservation expiry.

## Response Shape

Most handlers return JSON in one of these forms:

```typescript
type SuccessResponse<T> = {
  success: true;
  data?: T;
  message?: string;
};

type ErrorResponse = {
  success?: false;
  error: string;
  message?: string;
};
```

## Authentication

- Public auth routes use NextAuth
- User-facing book and profile routes require an authenticated session
- Admin request-management routes require `session.user.role === "ADMIN"`
- The reservation expiry cron route can additionally require `CRON_SECRET`

## Borrowing And Availability Endpoints

### `POST /api/book/requests`

Create a new borrow request for the signed-in user.

Request body:

```json
{
  "bookId": "book-uuid"
}
```

Behavior:

- requires authentication
- requires the user account to be `APPROVED`
- rejects duplicate active requests for the same book
- expires stale pending reservations older than 15 minutes
- increments `reservedCount` atomically when capacity exists
- creates a `PENDING` borrow record

Success response:

```json
{
  "success": true,
  "data": {
    "requestId": "borrow-record-uuid",
    "status": "PENDING",
    "availableCount": 3
  }
}
```

Common errors:

- `400` when `bookId` is missing
- `401` when unauthenticated
- `403` when the user is not approved
- `409` when the user already has an active request or the book is at capacity

### `PATCH /api/book/requests/[id]/approve`

Approve a pending request and convert it into an active loan.

Authorization:

- admin only

Behavior:

- transitions `PENDING -> BORROWED`
- decrements `reservedCount`
- increments `borrowedCount`
- returns `409` if the request is no longer pending

Success response:

```json
{
  "success": true,
  "data": {
    "requestId": "borrow-record-uuid",
    "status": "BORROWED",
    "availableCount": 3
  }
}
```

### `PATCH /api/book/requests/[id]/reject`

Reject a pending request.

Authorization:

- admin only

Behavior:

- transitions `PENDING -> REJECTED`
- decrements `reservedCount`
- returns `409` if the request is no longer pending

Success response:

```json
{
  "success": true,
  "data": {
    "requestId": "borrow-record-uuid",
    "status": "REJECTED",
    "availableCount": 4
  }
}
```

### `PATCH /api/book/requests/[id]/return`

Return an active loan.

Authorization:

- the borrowing user or an admin

Behavior:

- only works when the record is currently `BORROWED`
- compares `dueDate` with today
- transitions to:
  - `RETURNED` when returned on time
  - `LATE_RETURN` when overdue
- sets `returnDate`
- decrements `borrowedCount`

Success response:

```json
{
  "success": true,
  "data": {
    "requestId": "borrow-record-uuid",
    "status": "RETURNED",
    "returnDate": "2026-04-22",
    "isLate": false,
    "availableCount": 5
  }
}
```

Possible errors:

- `401` when unauthenticated
- `403` when the caller is neither admin nor owner
- `404` when the record does not exist
- `409` when the record is not currently `BORROWED`

### `GET /api/book/stream`

Open the public Server-Sent Events stream for book availability.

Query parameters:

- `bookId` optional, filters events to a specific book

Response headers:

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

Public event payload:

```json
{
  "type": "BOOK_UPDATED",
  "timestamp": "2026-04-22T10:00:00.000Z",
  "bookId": "book-uuid",
  "availableCount": 2,
  "reservedCount": 1,
  "borrowedCount": 4
}
```

Notes:

- only `BOOK_UPDATED` events are exposed publicly
- requests are rate-limited by IP
- the route also enforces a per-process listener cap of `100`
- failures return `429 Too Many Requests`

### `GET /api/book/cron/expire-reservations`

Expire stale pending reservations.

Authorization:

- optional bearer token guard via `CRON_SECRET`

Request header when configured:

```text
Authorization: Bearer <CRON_SECRET>
```

Behavior:

- finds `PENDING` borrow records older than 15 minutes
- transitions them to `REJECTED`
- decrements `reservedCount` per affected book
- revalidates book and user caches
- broadcasts dashboard and availability updates

Success response:

```json
{
  "success": true,
  "expired": 3,
  "affectedBooks": 2,
  "message": "Expired 3 stale reservation(s)."
}
```

## Existing User Endpoints

### `GET /api/user/profile`

Returns the signed-in user's profile.

### `PUT /api/user/profile`

Updates profile details such as `fullName` and avatar metadata.

### `PUT /api/avatar`

Updates the user's avatar. The schema now stores:

- `userAvatar`
- `userAvatarFileId`

### `GET /api/books`

Returns the book catalog.

The current schema now derives `availableCopies` from `totalCopies - borrowedCount - reservedCount`, so clients should treat `availableCopies` as a computed value rather than a directly mutable field.

### `GET /api/books/[id]`

Returns a single book, including:

```json
{
  "id": "book-uuid",
  "title": "Book Title",
  "totalCopies": 8,
  "availableCopies": 3
}
```

### `GET /api/user/borrow-records`

Returns the user's borrow history. Borrow records may now include:

```typescript
type BorrowStatus =
  | "PENDING"
  | "BORROWED"
  | "RETURNED"
  | "LATE_RETURN"
  | "REJECTED";
```

### `PUT /api/borrow-records/[id]/dismiss`

Dismisses completed records from the user's view.

## Existing Admin Endpoints

### `GET /admin/api/borrow-records`

Returns the admin borrow records table data.

The frontend now supports displaying and filtering `REJECTED` records in addition to the existing statuses.

### `GET /api/admin/dashboard`

Returns the admin dashboard snapshot.

### `GET /api/admin/dashboard/realtime`

Admin-only realtime refresh stream for dashboard refetch triggers.

This is separate from the public `/api/book/stream` inventory stream.

## Status Types

### User status

```typescript
type UserStatus = "PENDING" | "APPROVED" | "REJECTED";
```

### User role

```typescript
type UserRole = "USER" | "ADMIN";
```

### Borrow status

```typescript
type BorrowStatus =
  | "PENDING"
  | "BORROWED"
  | "RETURNED"
  | "LATE_RETURN"
  | "REJECTED";
```

## Rate Limiting

Known limits in the current implementation:

- avatar update limits remain in place
- receipt download limits remain in place
- public book SSE connections are rate-limited by IP

## Related Files

- `app/api/book/requests/route.ts`
- `app/api/book/requests/[id]/approve/route.ts`
- `app/api/book/requests/[id]/reject/route.ts`
- `app/api/book/requests/[id]/return/route.ts`
- `app/api/book/stream/route.ts`
- `app/api/book/cron/expire-reservations/route.ts`
- `database/schema.ts`
- `lib/actions/book.ts`
- `lib/admin/actions/borrow.ts`
