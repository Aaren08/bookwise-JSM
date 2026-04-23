# Performance Improvements

This document captures the uncommitted performance-focused changes in the repository.

## Key changes

- Added `lib/performance/bundle.tsx` to lazily load heavy UI components.
  - `LazyFileUpload` for file inputs.
  - `LazyReceiptModal` for receipt display.
  - `LazyImageCropper` for avatar cropping.
  - `LazyColorPicker` for admin book color selection.

- Added `lib/performance/PrefetchOnIntentLink.tsx`.
  - Prefetches routes on hover, focus, or touch intent.
  - Keeps route prefetching safe by guarding repeated calls.
  - Used broadly in public navigation and book links.

- Added `lib/performance/lcp.ts`.
  - Centralizes responsive image sizes for auth illustrations and book cover rendering.
  - Supports `BookCover` component sizing for LCP optimization.

- Added `lib/performance/navigation.ts`.
  - Builds search route hrefs with query, filter, and pagination parameters.
  - Provides pagination number generation with ellipsis handling.

- Updated `components/admin/tables/BorrowTable.tsx`.
  - Applies optimistic row-level status updates for near-instant feedback.
  - Tracks pending requests per row instead of freezing the entire table.
  - Memoizes borrow rows to reduce unnecessary re-renders during status changes.
  - Restricts the dropdown to valid transitions and now exposes `LATE_RETURN` for `BORROWED` records.

- Updated `lib/admin/actions/borrow.ts`.
  - Pages `borrow_records` first, then joins `books` and `users`.
  - Reduces join cost for the admin borrow-record table under larger datasets.

- Updated borrow-status API routes.
  - Replaced unsupported `db.transaction()` usage with single-statement atomic SQL compatible with the Neon HTTP driver.
  - Preserves consistency while keeping status updates fast and practical in production.

## Impact

- Reduced initial client bundle cost for non-critical admin UI.
- Improved perceived navigation performance by prefetching on intent.
- Boosted image rendering performance for book covers and auth illustrations.
- Standardized URL construction for search and pagination flows.
- Improved perceived performance for admin borrow status changes through optimistic UI.
- Reduced admin borrow-list query work by paginating the hot table before joins.
- Kept status writes atomic on Neon HTTP without introducing a heavier database client.

## Notes

- These changes are mainly client-side performance optimizations.
- Any component using lazy imports should still handle loading states gracefully.
- `searchBooks` and `BookCover` depend on these helpers for consistent behavior.
