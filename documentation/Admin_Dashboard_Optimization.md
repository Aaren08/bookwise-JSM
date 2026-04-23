# Admin Dashboard Optimization

This document describes the uncommitted admin dashboard and table loading changes.

## Key enhancements

- Added `components/admin/PartialTableWrapper.tsx`.
  - Keeps table headers visible while body rows are suspended.
  - Uses `Suspense` fallback with row-only skeletons.
  - Reduces layout shift during data fetch and pagination.

- Added `components/admin/skeleton/RowSkeleton.tsx`.
  - Renders lightweight row skeletons for multiple column types.
  - Supports `avatar-text`, `image-text`, `badge`, `date`, `actions`, and `button` cells.

- Added table header components in `components/admin/tables/table-header/`.
  - `BookTableHeader`, `UserTableHeader`, `BorrowTableHeader`, `AccountTableHeader`.
  - Allows headers to remain visible independently from body suspense.

- Added `components/admin/AdminSearchClient.tsx` and `components/admin/context/SearchContext.tsx`.
  - Provides shared query and sort state across admin pages.
  - Uses deferred search input updates with debouncing.

- Updated admin table components.
  - `BookTable`, `UserTable`, `BorrowTable`, `AccountTable` now use `useSortedData` and shared search state.
  - Extracted memoized row components and local state updates to reduce re-renders.
  - `BorrowTable` now performs optimistic per-row status updates with rollback on failure.
  - `BorrowTable` keeps request-pending state per row and allows `LATE_RETURN` as a direct option for borrowed items.

- Updated `lib/admin/actions/borrow.ts`.
  - The borrow-record list now pages `borrow_records` before joining related book and user data.
  - This reduces unnecessary join work for paginated admin tables.

- Updated `components/admin/dashboard/AdminDashboardRealtime.tsx`.
  - Lazy-loads non-critical dashboard sections using dynamic imports.
  - Improves dashboard load time by delaying heavier components.

## Resulting behavior

- Admin pages now provide a smoother load experience.
- Table headers remain stable while body content fetches and updates.
- Search and sort controls share context, giving consistent state across admin sections.
- Borrow status changes feel immediate while still rolling back cleanly on conflicts or server failures.
- Borrow record pages scale better because the heaviest joins happen only after pagination.

## Testing considerations

- Verify admin table pagination and sort behavior after data fetch.
- Validate that skeleton placeholders match the final row layout.
- Confirm admin search input updates the shared query state correctly.
