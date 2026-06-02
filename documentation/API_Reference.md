# API Reference

## Overview

BookWise exposes authenticated Next.js route handlers for user, admin, and internal library workflows. This document covers the complete current API surface organized by domain.

## Related Documentation

For realtime-specific endpoints, see:

- [Admin Realtime API Routes](Admin_Realtime_API_Routes.md) — `/api/admin/realtime/rows`, `/api/admin/sync`, `/api/admin/locks`
- [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md) — `/api/admin/dashboard/realtime`
- [Admin Session Invalidation](Admin_Session_Invalidation.md) — `/api/admin/session/realtime`
- [Book Availability Realtime](Book_Availability_Realtime.md) — `/api/book/stream`

---

## Response Shape

All handlers return JSON in one of these forms:

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

---

## Authentication

| Route group                                    | Auth requirement                               |
| ---------------------------------------------- | ---------------------------------------------- |
| Public auth routes                             | NextAuth — no session required                 |
| `/api/auth/imagekit`                           | No session required                            |
| `/api/book/stream`                             | No session required (rate-limited by IP)       |
| `/api/book/requests` and sub-routes            | Authenticated session, `status === "APPROVED"` |
| `/api/user/*`, `/api/avatar`, `/api/receipt/*` | Authenticated session                          |
| `/api/admin/*`                                 | Authenticated session + `role === "ADMIN"`     |
| `/api/book/cron/expire-reservations`           | Optional `Authorization: Bearer <CRON_SECRET>` |
| `/api/setup`                                   | No session (system uninitialized)              |

---

## System Setup

### `POST /api/setup`

One-time system initialization. Creates the first admin account and persists system configuration atomically. Returns `409` if the system has already been initialized.

This endpoint is protected by a PostgreSQL advisory lock and a guard CTE — concurrent requests cannot both succeed even under race conditions.

**Request body:**

```json
{
  "fullName": "Admin Name",
  "email": "admin@example.com",
  "password": "securepassword",
  "userAvatar": "https://ik.imagekit.io/your-id/avatar.jpg",
  "userAvatarFileId": "imagekit-file-id",
  "borrowDurationDays": "{borrowDurationDays}",
  "supportEmail": "support@example.com",
  "websiteUrl": "https://example.com",
  "universityName": "Example University"
}
```

**Responses:**

| Status | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| `200`  | Setup completed; admin account and system config created |
| `400`  | Zod validation failed                                    |
| `409`  | System already initialized                               |
| `500`  | Unexpected server error                                  |

---

## Authentication Routes

### `GET/POST /api/auth/[...nextauth]`

Handled by NextAuth v5. Covers `/api/auth/signin`, `/api/auth/signout`, `/api/auth/session`, `/api/auth/csrf`.

### `GET /api/auth/imagekit`

Returns signed ImageKit upload parameters for client-side uploads.

```json
{
  "signature": "...",
  "expire": 1714000000,
  "token": "...",
  "publicKey": "public_..."
}
```

No authentication required. Parameters are short-lived and validated by ImageKit server-side.

---

## Borrowing and Availability Endpoints

### `POST /api/book/requests`

Create a new borrow request for the signed-in user.

**Request body:**

```json
{ "bookId": "book-uuid" }
```

**Behavior:**

- Requires authentication and `status === "APPROVED"`
- Rejects duplicate active requests for the same book
- Lazily expires stale `PENDING` reservations older than 15 minutes before checking capacity
- Atomically increments `reservedCount` only when `reservedCount + borrowedCount < totalCopies`
- Creates a `borrow_records` row with `borrowStatus = "PENDING"` and `reservedAt = NOW()`
- Broadcasts book availability and admin dashboard updates

**Success response (`201`):**

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

**Common errors:**

| Status | Reason                                             |
| ------ | -------------------------------------------------- |
| `400`  | `bookId` missing                                   |
| `401`  | Unauthenticated                                    |
| `403`  | User account not approved                          |
| `409`  | Active request already exists, or book at capacity |

---

### `PATCH /api/book/requests/[id]/approve`

Approve a pending request and convert it into an active loan.

**Authorization:** admin only

**Behavior:**

- Validates lock ownership via `assertLockOwnership()`
- Requires the record to currently be `PENDING`
- Uses a single CTE SQL statement to atomically:
  - Transition `PENDING → BORROWED`
  - Decrement `reservedCount`
  - Increment `borrowedCount`
- Revalidates book and user caches
- Broadcasts dashboard and availability updates

**Success response:**

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

**Errors:**

| Status | Reason                                          |
| ------ | ----------------------------------------------- |
| `401`  | Unauthenticated                                 |
| `403`  | Not an admin                                    |
| `404`  | Record not found                                |
| `409`  | Record is no longer `PENDING`, or lock conflict |

---

### `PATCH /api/book/requests/[id]/reject`

Reject a pending request.

**Authorization:** admin only

**Behavior:**

- Validates lock ownership
- Requires the record to currently be `PENDING`
- Atomically transitions `PENDING → REJECTED` and decrements `reservedCount`
- Broadcasts updated availability

**Success response:**

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

---

### `PATCH /api/book/requests/[id]/return`

Return an active loan.

**Authorization:** the borrowing user or any admin

**Behavior:**

- Requires the record to currently be `BORROWED`
- Compares `dueDate` with today to determine status:
  - On time → `RETURNED`
  - Overdue → `LATE_RETURN`
- Sets `returnDate`
- Atomically decrements `borrowedCount`

**Success response:**

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

**Errors:**

| Status | Reason                                   |
| ------ | ---------------------------------------- |
| `401`  | Unauthenticated                          |
| `403`  | Caller is neither admin nor record owner |
| `404`  | Record not found                         |
| `409`  | Record is not currently `BORROWED`       |

---

### `GET /api/book/stream`

Public Server-Sent Events stream for book inventory updates. No authentication required.

**Query parameters:**

| Param    | Required | Description                           |
| -------- | -------- | ------------------------------------- |
| `bookId` | No       | Filter events to a specific book UUID |

**Response headers:**

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

**Event format:**

```
id: 42
event: BOOK_UPDATED
data: {"type":"BOOK_UPDATED","timestamp":"2026-04-22T10:00:00.000Z","bookId":"book-uuid","availableCount":2,"reservedCount":1,"borrowedCount":4}
```

**Notes:**

- Only `BOOK_UPDATED` events are exposed publicly; `REQUEST_UPDATED` is filtered out
- Supports `Last-Event-ID` for replay on reconnect (last 250 events buffered in Redis)
- Rate-limited by IP: 12 SSE connect attempts/min; max 2 concurrent streams per IP
- Returns `429 Too Many Requests` with `Retry-After` header when limits are exceeded
- Returns `X-Connection-Limit` header when the concurrent stream cap is reached

See [Book Availability Realtime](Book_Availability_Realtime.md) for full stream documentation.

---

### `GET /api/book/cron/expire-reservations`

Expire stale pending reservations older than 15 minutes.

**Authorization:** optional `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured

**Behavior:**

- Finds `PENDING` borrow records where `reservedAt < NOW() - 15 minutes`
- Bulk-transitions them to `REJECTED`
- Decrements `reservedCount` per affected book
- Revalidates book and user caches
- Broadcasts dashboard and availability updates

**Success response:**

```json
{
  "success": true,
  "expired": 3,
  "affectedBooks": 2,
  "message": "Expired 3 stale reservation(s)."
}
```

---

## User Endpoints

### `GET /api/user/profile`

Returns the signed-in user's profile data.

### `PUT /api/user/profile`

Updates profile details such as `fullName`.

### `PUT /api/avatar`

Updates the user's avatar. Stores `userAvatar` (CDN URL) and `userAvatarFileId` (ImageKit file ID) on the user record, then updates the NextAuth session.

**Rate limits:** 10 uploads/day, 5 profile updates/day

**Response:**

```json
{ "success": true }
```

### `GET /api/books`

Returns the public book catalog. `availableCopies` in each book is a computed value derived from `totalCopies - borrowedCount - reservedCount`. Treat it as read-only.

### `GET /api/books/[id]`

Returns a single book record:

```json
{
  "id": "book-uuid",
  "title": "Book Title",
  "totalCopies": 8,
  "borrowedCount": 3,
  "reservedCount": 2,
  "availableCopies": 3
}
```

### `GET /api/user/borrow-records`

Returns the signed-in user's borrow history. Records may have any of the following statuses:

```typescript
type BorrowStatus =
  | "PENDING"
  | "BORROWED"
  | "RETURNED"
  | "LATE_RETURN"
  | "REJECTED";
```

### `PUT /api/borrow-records/[id]/dismiss`

Soft-deletes a completed record from the user's view by setting `dismissed = 1`. The record remains in the database for historical purposes.

---

## Admin Dashboard Endpoints

### `GET /api/admin/dashboard`

Returns a snapshot of current admin dashboard statistics (total books, total users, borrowed books, pending account approvals, recent activity).

**Authorization:** admin only

Used by the `Statistics` component and re-fetched by `useAdminDashboardRealtime` after every realtime refresh signal.

### `GET /api/admin/dashboard/realtime`

Admin-only SSE stream that delivers `dashboard:refresh` signals whenever a mutation affects dashboard-relevant data. Clients wait 3000 ms after receiving a signal before re-fetching the snapshot.

**Authorization:** admin only

This stream carries signals only — no raw data. See [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md).

---

## Admin Session Endpoint

### `GET /api/admin/session/realtime`

SSE stream for real-time session invalidation. Pushes a `session:invalidated` event when the signed-in admin's role is revoked.

**Authorization:** admin only (returns `403` immediately if role is not `ADMIN`)

**Event types sent to client:**

| Event                 | When                                | Client action                        |
| --------------------- | ----------------------------------- | ------------------------------------ |
| `session:connected`   | On stream open                      | Reset reconnect backoff              |
| `session:invalidated` | Role change detected for this user  | `signOut()` + redirect to `/sign-in` |
| `session:reconnect`   | Max stream lifetime reached (5 min) | Reconnect immediately                |
| `session:error`       | Redis subscription error            | Reconnect with backoff               |

See [Admin Session Invalidation](Admin_Session_Invalidation.md).

---

## Admin Realtime Row Endpoints

These endpoints power the admin table realtime system (row-level locking, CREATE/UPDATE/DELETE events). Full documentation in [Admin Realtime API Routes](Admin_Realtime_API_Routes.md).

| Method   | Path                       | Purpose                                        |
| -------- | -------------------------- | ---------------------------------------------- |
| `GET`    | `/api/admin/realtime/rows` | SSE stream for all admin row and lock events   |
| `GET`    | `/api/admin/sync`          | Re-hydrate locks and rows after reconnect      |
| `GET`    | `/api/admin/locks`         | Fetch current locks for given row IDs          |
| `POST`   | `/api/admin/locks`         | Acquire a row lock                             |
| `PATCH`  | `/api/admin/locks`         | Heartbeat-only lock refresh (requires `token`) |
| `DELETE` | `/api/admin/locks`         | Release a row lock (requires `token`)          |

---

## Admin Book Management

Admin book mutations are implemented as **Next.js server actions** in `lib/admin/actions/book.ts`, not as standalone REST endpoints. They are called directly from admin form components and are protected by `requireAdminActor()`.

| Action         | Function                                           | Notes                                       |
| -------------- | -------------------------------------------------- | ------------------------------------------- |
| Create book    | `createBook(data)`                                 | Publishes `CREATE` event to `books` channel |
| Update book    | `updateBook(id, data, expectedVersion, lockToken)` | Version-checked; lock required              |
| Delete book    | `deleteBook(id, expectedVersion, lockToken)`       | Blocked if active borrows exist             |
| Get all books  | `getAllBooks(page, limit, query, genre)`           | Paginated; used by admin book table         |
| Get book by ID | `getBookById(id)`                                  | Single record fetch                         |

---

## Admin User Management

Admin user mutations are implemented as **Next.js server actions** in `lib/admin/actions/user.ts`.

| Action             | Function                                                       | Notes                                                                      |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Get approved users | `getApprovedUsers({ page, limit })`                            | Includes `booksBorrowed` count                                             |
| Get pending users  | `getPendingUsers({ page, limit })`                             | Account approval queue                                                     |
| Approve account    | `approveAccount({ userId, expectedVersion, lockToken })`       | PENDING → APPROVED; triggers email                                         |
| Reject account     | `rejectAccount({ userId, expectedVersion, lockToken })`        | PENDING → REJECTED; triggers email                                         |
| Delete user        | `deleteUser({ userId, expectedVersion, lockToken })`           | Blocked if active borrows exist                                            |
| Update role        | `updateUserRole({ userId, role, expectedVersion, lockToken })` | Last-admin guard on downgrade; increments `sessionVersion` on ADMIN → USER |

---

## Receipt Endpoints

### `POST /api/receipt/download` (or `GET`)

Downloads a receipt PDF for a given borrow record.

**Authorization:** authenticated user (record owner or admin)

**Rate limits:** 5 downloads/minute per user+receipt combination, 10/day

### Receipt Generation (Server Action)

`generateReceipt(borrowRecordId)` in `lib/admin/actions/receipt.ts`:

- Admin only
- Transitions `PENDING → BORROWED`
- Sets `borrowDate = NOW()` and recalculates `dueDate` from current `borrowDurationDays`
- Returns a formatted `Receipt` object

```typescript
type Receipt = {
  receiptId: string; // First 8 chars of UUID, uppercased
  issuedAt: string; // "DD/MM/YYYY, hh:mm A"
  title: string;
  author: string;
  genre: string;
  borrowedOn: string; // "DD/MM/YYYY"
  dueDate: string; // "DD/MM/YYYY"
  duration: string; // e.g. "14 Days"
  userName: string;
  userEmail: string;
};
```

---

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

---

## Rate Limiting Summary

| Endpoint / Category                 | Identity           | Limit                           |
| ----------------------------------- | ------------------ | ------------------------------- |
| Auth endpoints                      | Per IP             | Token bucket: 3/10 min, burst 6 |
| Anonymous API requests              | Per IP             | 60 req/min sliding window       |
| Authenticated API requests          | Per user           | 300 req/min sliding window      |
| `/api/book/stream` connect attempts | Anonymous          | 12/min                          |
| `/api/book/stream` connect attempts | Authenticated      | 30/min                          |
| Concurrent SSE streams              | Anonymous          | 2 per IP                        |
| Concurrent SSE streams              | Authenticated      | 3 per user                      |
| Avatar upload                       | Per user           | 10/day                          |
| Avatar update                       | Per user           | 5/day                           |
| Receipt download                    | Per user + receipt | 5/min, 10/day                   |

When a limit is exceeded the server returns `429 Too Many Requests` with:

```
Retry-After: <seconds>
X-RateLimit-Limit: <limit>
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <unix timestamp>
```

See [Rate Limiting](Rate_Limiting.md) for full configuration details.

---

## Related Files

- `app/api/setup/route.ts`
- `app/api/book/requests/route.ts`
- `app/api/book/requests/[id]/approve/route.ts`
- `app/api/book/requests/[id]/reject/route.ts`
- `app/api/book/requests/[id]/return/route.ts`
- `app/api/book/stream/route.ts`
- `app/api/book/cron/expire-reservations/route.ts`
- `app/api/admin/dashboard/route.ts`
- `app/api/admin/dashboard/realtime/route.ts`
- `app/api/admin/session/realtime/route.ts`
- `app/api/admin/realtime/rows/route.ts`
- `app/api/admin/locks/route.ts`
- `app/api/admin/sync/route.ts`
- `app/api/avatar/route.ts`
- `app/api/receipt/download/route.ts`
- `database/schema.ts`
- `lib/actions/book.ts`
- `lib/admin/actions/book.ts`
- `lib/admin/actions/borrow.ts`
- `lib/admin/actions/user.ts`
- `lib/admin/actions/receipt.ts`
