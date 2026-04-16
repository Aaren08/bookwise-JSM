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

## Impact

- Reduced initial client bundle cost for non-critical admin UI.
- Improved perceived navigation performance by prefetching on intent.
- Boosted image rendering performance for book covers and auth illustrations.
- Standardized URL construction for search and pagination flows.

## Notes

- These changes are mainly client-side performance optimizations.
- Any component using lazy imports should still handle loading states gracefully.
- `searchBooks` and `BookCover` depend on these helpers for consistent behavior.
