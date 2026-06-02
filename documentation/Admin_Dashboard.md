# Admin Dashboard

## Overview

The admin dashboard provides comprehensive management tools for library administrators to oversee all aspects of the BookWise system. It includes user management, book catalog administration, borrowing oversight, and system analytics.

## Dashboard Structure

### Route Organization

Admin routes are organized under `/admin` with role-based protection:

```
admin/
├── layout.tsx          # Admin layout with sidebar and SessionGuard
├── page.tsx            # Dashboard home
├── users/              # User management
├── books/              # Book catalog management
├── borrow-records/     # Borrowing oversight
└── account-requests/   # Account approval queue
```

### Layout Components

#### AdminLayout

```tsx
// app/admin/layout.tsx
const Layout = async ({ children }) => {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  // Re-verify role from database on every request
  const isAdmin = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
    .then((res) => res[0]?.role === "ADMIN");

  if (!isAdmin) redirect("/");

  return (
    <main>
      <Sidebar session={session} />
      <SessionGuard />
      {children}
    </main>
  );
};
```

`SessionGuard` mounts the `useSessionInvalidation` hook which holds an open SSE connection to `/api/admin/session/realtime`. When an admin's role is revoked, this stream receives a `session:invalidated` event and signs the user out immediately — no need to wait for the JWT to expire. See [Admin Session Invalidation](Admin_Session_Invalidation.md).

#### Sidebar Navigation

```tsx
const adminSideBarLinks = [
  { img: "/icons/admin/home.svg",    route: "/admin",               text: "Home" },
  { img: "/icons/admin/users.svg",   route: "/admin/users",         text: "All Users" },
  { img: "/icons/admin/book.svg",    route: "/admin/books",         text: "All Books" },
  { img: "/icons/admin/borrow.svg",  route: "/admin/borrow-records",text: "Borrow Records" },
  { img: "/icons/admin/request.svg", route: "/admin/account-requests", text: "Account Requests" },
];
```

## Dashboard Home

### Statistics Overview

The main dashboard displays key metrics via the `Statistics` component. Data is fetched from `GET /api/admin/dashboard` and refreshed via the realtime SSE stream. The component animates stat changes with a 3000 ms delay window.

```tsx
<Statistics
  totalBooks={stats.totalBooks}
  totalUsers={stats.totalUsers}
  borrowedBooks={stats.borrowedBooks}
/>
```

**Metrics tracked:**

- Total books in catalog
- Total registered users
- Currently borrowed books
- Pending account approvals

### Real-Time Refresh

The admin dashboard uses Upstash Redis pub/sub and a per-instance broker to keep all open admin sessions synchronized. After any mutation, connected admin clients receive an SSE signal and re-fetch the dashboard snapshot after a 3000 ms batching window.

See [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md) for full architecture details.

### Recent Activity

Shows recent system activity:

- New user registrations
- Recent book additions
- Borrow approvals
- Overdue returns

### Quick Actions

Fast access to common tasks:

- Approve pending accounts
- Add new books
- View overdue books

## User Management

### User List View

Comprehensive user management interface. The `UserTable` component uses shared search context (`SearchContext`) and the `useRealtimeUpdates` hook so changes made by another admin are reflected without a page reload.

```tsx
<UserTable
  users={users}
  onStatusChange={handleStatusChange}
  onRoleChange={handleRoleChange}
  onDelete={handleDelete}
/>
```

**Features:**

- Search and filter users
- Role management (USER ↔ ADMIN)
- Account deletion (blocked while active borrows exist)
- Status updates with optimistic UI and rollback

### Account Approval

Dedicated interface for account requests:

```tsx
<AccountRequestsTable
  pendingUsers={pendingUsers}
  onApprove={handleApprove}
  onReject={handleReject}
/>
```

**Approval process:**

1. Review user details and uploaded university card
2. Approve or reject the account
3. Notification email is triggered automatically
4. User status updates in real time across all admin sessions

### Row-Level Locking

Before editing a user record, the admin dashboard acquires a distributed Redis lock on that row. Other admins see a "Currently being edited by Jane Admin" indicator and cannot edit the same row simultaneously. Locks expire after 60 seconds and are refreshed every 20 seconds while the edit form is open.

See [Admin Row Concurrency](Admin_Row_Concurrency.md) for full details.

## Book Management

### Book Catalog Administration

Full CRUD operations for books. The `BookTable` uses `useRealtimeUpdates` for live row updates and `useRowLock` for concurrent edit protection.

```tsx
<BookTable
  books={books}
  onEdit={handleEdit}
  onDelete={handleDelete}
  onAdd={handleAdd}
/>
```

### Book Creation Form

```tsx
<BookForm onSubmit={handleCreateBook} initialData={null} />
```

**Required fields:**

- Title, author, genre
- Total copy count
- Cover image URL and cover color
- Description and summary
- Video trailer URL (optional)

`borrowedCount` and `reservedCount` are initialized to `0`. `availableCopies` is a generated column computed automatically by the database — it is never set manually.

### Book Editing

Editing a book record follows the lock-acquire → edit → version-checked save flow:

1. Admin opens edit form → lock acquired via `POST /api/admin/locks`
2. Admin makes changes locally
3. Admin submits form → `updateBook()` server action runs `updateWithVersionCheck()`
4. If another admin saved changes in the meantime, a version conflict error is returned
5. Lock released in a `finally` block regardless of outcome

### Availability Counter Updates

When borrow statuses change, the counters on the `books` table are updated atomically — never `availableCopies` directly, as it is a generated column:

```typescript
// Admin approves a request
await db.update(books).set({
  reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
  borrowedCount: sql`${books.borrowedCount} + 1`,
});

// Admin rejects a request
await db.update(books).set({
  reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
});

// Book returned
await db.update(books).set({
  borrowedCount: sql`GREATEST(0, ${books.borrowedCount} - 1)`,
});
```

## Borrow Records Management

### Borrow Records Table

Complete borrowing oversight. `BorrowTable` supports the full `BorrowStatus` set including `REJECTED` and `LATE_RETURN`, and performs optimistic per-row status updates with rollback on failure.

```tsx
<BorrowRecordsTable
  records={borrowRecords}
  onStatusChange={handleStatusChange}
  onGenerateReceipt={handleGenerateReceipt}
/>
```

**Features:**

- Filter by status, user, book, date
- Sort by borrow date, due date
- Optimistic status updates (row updates immediately; rolls back on conflict)
- Per-row pending state (one request does not block the whole table)
- Receipt generation

### Status Lifecycle

```
PENDING  → BORROWED     (admin approves via PATCH /api/book/requests/:id/approve)
PENDING  → REJECTED     (admin rejects via PATCH /api/book/requests/:id/reject)
BORROWED → RETURNED     (returned on time via PATCH /api/book/requests/:id/return)
BORROWED → LATE_RETURN  (returned after due date via same return endpoint)
```

Invalid transitions are filtered out of the dropdown menu before being sent to the server.

### Receipt Generation

Approving a borrow request and generating its receipt are the same operation. The `generateReceipt()` server action transitions a `PENDING` record to `BORROWED`, sets the `borrowDate` to now, recalculates `dueDate` from the current `borrowDurationDays` setting, and returns a formatted `Receipt` object.

```tsx
<GenerateReceipt borrowRecordId={record.id} status={record.borrowStatus} />
```

## Analytics and Reporting

The dashboard home provides real-time metrics refreshed via the SSE signal-and-fetch pattern.

> **Note:** Advanced reporting features (monthly borrowing trends, CSV/JSON export, PDF reports) are **planned but not yet implemented**. The sections below describe intended future behavior.

### Planned: Usage Reports

- Monthly borrowing trends
- Popular books analytics
- User activity reports

### Planned: Data Export

- CSV for spreadsheet analysis
- JSON for API integration

## Search and Filtering

### Global Search

Admin pages share search state through `SearchContext`, provided by `AdminSearchClient`. Search input updates are debounced before triggering data fetches.

**Search types:**

- Users — by name, email, university ID
- Books — by title, author, genre
- Borrow records — by user, book, status

### Advanced Filtering

```tsx
<FilterData
  filters={activeFilters}
  onFilterChange={handleFilterChange}
  availableFilters={filterOptions}
/>
```

### Skeleton Loading

`PartialTableWrapper` keeps table headers visible while body rows are suspended, reducing layout shift during data fetches and pagination:

```tsx
<PartialTableWrapper header={<BookTableHeader />}>
  <Suspense fallback={<RowSkeleton columns={["image-text","badge","date","actions"]} />}>
    <BookTableBody />
  </Suspense>
</PartialTableWrapper>
```

## Security and Permissions

### Role-Based Access

Admin role is re-verified from the database on every admin layout render. JWT role alone is not sufficient — the live database value is authoritative.

```typescript
const isAdmin = await db
  .select({ role: users.role })
  .from(users)
  .where(eq(users.id, session.user.id))
  .limit(1)
  .then((res) => res[0]?.role === "ADMIN");

if (!isAdmin) redirect("/");
```

### Session Invalidation

When an admin is downgraded to `USER`, a `RoleChangeEvent` is published to Redis and fanned out to that admin's open SSE connections. All their active browser tabs sign out and redirect to `/sign-in` immediately — no waiting for JWT expiry. See [Admin Session Invalidation](Admin_Session_Invalidation.md).

### Lock Ownership Enforcement

All admin mutation endpoints call `assertLockOwnership()` before performing any database change. If the lock has expired or is held by another admin, the endpoint returns `409 Conflict`.

## Performance Optimizations

### Paginated Queries

The admin borrow records query pages `borrow_records` first, then joins `books` and `users` only for the current page. This reduces join cost under larger datasets:

```typescript
// lib/admin/actions/borrow.ts
// Page the hot table first, then join related data
```

### Caching Strategy

- Dashboard snapshot cached and revalidated via `revalidatePath("/admin")`
- Static dashboard sections use server components
- Non-critical dashboard sections are lazy-loaded via dynamic imports (`AdminDashboardRealtime.tsx`)

### Memoized Table Rows

Borrow rows are memoized to avoid full-table re-renders when a single row's status changes during an optimistic update.

## Mobile Responsiveness

Admin dashboard is fully responsive:

- Collapsible sidebar for mobile
- Touch-friendly interface
- Optimized table layouts for narrow viewports

## Related Components

- `AdminSearchClient.tsx` — Global search input with shared context
- `SearchContext.tsx` — Shared query and sort state across admin pages
- `PartialTableWrapper.tsx` — Suspense wrapper preserving table headers
- `RowSkeleton.tsx` — Row-level loading skeleton
- `BookTableHeader.tsx`, `UserTableHeader.tsx`, `BorrowTableHeader.tsx`, `AccountTableHeader.tsx` — Stable table headers
- `BookTable.tsx`, `UserTable.tsx`, `BorrowTable.tsx`, `AccountTable.tsx` — Table body components
- `GenerateReceipt.tsx` — Receipt generation trigger
- `Statistics.tsx` — Dashboard metrics display
- `Sidebar.tsx` — Admin navigation sidebar
- `SessionGuard.tsx` — Mounts session invalidation hook
- `RowLockIndicator.tsx` — "Currently being edited by" badge

## API Endpoints

### Dashboard Data

```typescript
// Get admin dashboard snapshot (statistics, recent activity)
GET /api/admin/dashboard

// Admin-only SSE stream for dashboard refresh signals
GET /api/admin/dashboard/realtime
```

### Borrow Record Management

```typescript
// Approve a pending request (transitions PENDING → BORROWED)
PATCH /api/book/requests/[id]/approve

// Reject a pending request (transitions PENDING → REJECTED)
PATCH /api/book/requests/[id]/reject

// Return a borrowed book (transitions BORROWED → RETURNED or LATE_RETURN)
PATCH /api/book/requests/[id]/return

// Expire stale pending reservations (cron job)
GET /api/book/cron/expire-reservations
```

### Realtime Infrastructure

```typescript
// Admin row-level SSE stream (CREATE/UPDATE/DELETE events + lock events)
GET /api/admin/realtime/rows

// Post-reconnect state resync
GET /api/admin/sync

// Row lock management
GET    /api/admin/locks   // Fetch current locks
POST   /api/admin/locks   // Acquire a lock
PATCH  /api/admin/locks   // Heartbeat refresh
DELETE /api/admin/locks   // Release a lock

// Session invalidation SSE stream
GET /api/admin/session/realtime
```

For full endpoint documentation see [API Reference](API_Reference.md) and [Admin Realtime API Routes](Admin_Realtime_API_Routes.md).
