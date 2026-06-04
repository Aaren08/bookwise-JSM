# Admin Dashboard Optimization

This document describes the admin dashboard and table loading improvements introduced alongside the realtime and counter-based inventory changes. For the broader performance improvements across the public-facing application, see [Performance Improvements](Performance_Improvements.md). For the admin dashboard's realtime architecture, see [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md).

---

## Key Enhancements

### `components/admin/PartialTableWrapper.tsx`

Keeps table headers visible while the table body rows are suspended during data fetch and pagination.

- Uses `Suspense` with a row-only skeleton fallback
- Reduces layout shift when navigating between pages or applying filters
- Header components remain mounted and interactive while body data loads

### `components/admin/skeleton/RowSkeleton.tsx`

Lightweight row skeleton rendered inside `PartialTableWrapper`'s `Suspense` fallback.

Supports the following column types:

| Column type | Description |
|---|---|
| `avatar-text` | Circular avatar placeholder + text line |
| `image-text` | Rectangular image placeholder + text line |
| `badge` | Rounded badge-shaped placeholder |
| `date` | Short text placeholder |
| `actions` | Button-shaped placeholder(s) |
| `button` | Single button placeholder |

### Table Header Components

Located in `components/admin/tables/table-header/`:

- `BookTableHeader`
- `UserTableHeader`
- `BorrowTableHeader`
- `AccountTableHeader`

These are rendered outside the `Suspense` boundary so headers stay stable while body data fetches or re-fetches.

### `components/admin/AdminSearchClient.tsx` and `components/admin/context/SearchContext.tsx`

Provides shared query and sort state across all admin pages.

- Search input updates are debounced before triggering data fetches
- Sort state is shared so switching between admin sections preserves the last sort
- Replaces per-table search state that was previously duplicated across components

---

## Updated Admin Table Components

The following table components have been updated. All are located in `components/admin/tables/`:

### All Tables (`BookTable`, `UserTable`, `BorrowTable`, `AccountTable`)

- Now consume shared search and sort state from `SearchContext`
- Use `useSortedData` for consistent sort behaviour across table types
- Extract memoized row components to reduce re-renders when a single row updates

### `BorrowTable` — Additional Changes

**Optimistic status updates:**

Status changes are applied locally before the server confirms, giving near-instant feedback. If the API call fails or returns a conflict, the previous row state is restored. See [Borrowing System — Admin UI Behaviour](Borrowing_System.md#admin-ui-behavior) for the full status transition rules.

**Per-row pending state:**

Pending state is tracked per row rather than per table. One in-flight status change does not freeze the rest of the table.

**`LATE_RETURN` as a direct option:**

`LATE_RETURN` is now available as a direct dropdown selection for `BORROWED` records. This reflects the fact that a return can be confirmed as late by an admin without waiting for the automatic due-date comparison. See [Borrowing System — Status Lifecycle](Borrowing_System.md#status-lifecycle) for the full transition table.

**Invalid transition filtering:**

Transitions that are not valid for the current status are removed from the dropdown before the component renders, rather than being sent to the server and rejected.

---

## Updated `lib/admin/actions/borrow.ts`

The borrow-record list query now **pages `borrow_records` first**, then joins the related `books` and `users` data for only the rows on the current page.

Previously the query joined all three tables before pagination, which increased join cost linearly with the total number of borrow records.

The new approach:

1. `SELECT id, ... FROM borrow_records ORDER BY borrow_date DESC LIMIT n OFFSET m`
2. Collect `bookId` and `userId` values for the page
3. Join `books` and `users` only for those IDs

This is supported by the `borrow_date_idx` index added in migration `0005_borrow_records_borrow_date_idx.sql`. See [Database — Migration History](Database.md#migration-history).

---

## Updated `components/admin/dashboard/AdminDashboardRealtime.tsx`

Non-critical dashboard sections are now lazy-loaded using Next.js `dynamic()` imports. This defers the JavaScript cost for heavier dashboard components until after the initial paint, improving the dashboard's perceived load time.

---

## Resulting Behaviour

| Concern | Before | After |
|---|---|---|
| Table headers during load | Hidden while body suspends | Always visible |
| Layout shift on paginate | Entire table re-renders | Header stable; only body re-renders |
| Search state | Per-table, lost on section switch | Shared via `SearchContext`, persists across sections |
| Borrow status changes | Blocked whole table while in flight | Per-row pending; rest of table stays interactive |
| Conflict on status change | Server error surfaced generically | Previous row state restored; user can retry |
| Admin borrow list query | Full join before pagination | Paginate first, then targeted join |
| Dashboard initial load | All sections fetched together | Non-critical sections deferred via dynamic imports |

---

## Testing Considerations

- Verify table pagination and sort behaviour after data fetches complete
- Confirm skeleton placeholders match the final row column layout for each table type
- Validate that `AdminSearchClient` debounce updates `SearchContext` correctly and that all tables respond
- Confirm optimistic borrow status updates roll back cleanly on API failure and on `409 Conflict` responses
- Verify `LATE_RETURN` appears as an option for `BORROWED` rows and is accepted by `PATCH /api/book/requests/:id/return`
- Check that `borrow_date_idx` is present in the database before deploying the updated query (migration `0005`)

---

## Related Documentation

- [Admin Dashboard](Admin_Dashboard.md) — UI components, layout, and realtime refresh
- [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md) — Redis pub/sub signal-and-refresh architecture
- [Borrowing System](Borrowing_System.md) — status transition rules and counter model
- [Performance Improvements](Performance_Improvements.md) — public-facing performance changes (bundle splitting, LCP, navigation)
- [Database](Database.md) — `borrow_date_idx` and other index definitions
- [Cache and Search Consistency](Cache_and_Search_Consistency.md) — tag-based cache invalidation after admin mutations
