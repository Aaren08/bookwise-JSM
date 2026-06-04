# Performance Improvements

This document captures the performance-focused changes introduced alongside the realtime and inventory refactors. Changes are grouped by concern. Where a topic is covered in depth elsewhere, this document links out rather than duplicating.

> **Related documents:**
> - Admin table loading optimisations → [Admin Dashboard Optimization](Admin_Dashboard_Optimization.md)
> - Tag-based caching and search routing → [Cache and Search Consistency](Cache_and_Search_Consistency.md)
> - Navigation loading bar → [Top Loader Navigation](Top_Loader_Navigation.md)

---

## Bundle Splitting

**File:** `lib/performance/bundle.tsx`

Heavy UI components that are not needed on initial load are wrapped with Next.js `dynamic()` so their JavaScript is only fetched when a component is actually rendered:

```typescript
// lib/performance/bundle.tsx
export const LazyFileUpload    = dynamic(() => import("@/components/FileUpload"));
export const LazyReceiptModal  = dynamic(() => import("@/components/ReceiptModal"));
export const LazyImageCropper  = dynamic(() => import("@/components/ImageCropper"));
export const LazyColorPicker   = dynamic(() => import("@/components/admin/forms/ColorPicker"));
```

- `LazyFileUpload` — file input used on registration and admin book forms; not needed on most pages
- `LazyReceiptModal` — receipt display and PDF generation; only needed when viewing borrow history or admin borrow records
- `LazyImageCropper` — avatar crop modal; only needed when a user opens the profile editor
- `LazyColorPicker` — admin book cover color picker; only needed inside the admin book form

Any component using these lazy imports should render a meaningful loading state (skeleton or spinner) while the chunk loads. The `RowSkeleton` component (see [Admin Dashboard Optimization](Admin_Dashboard_Optimization.md)) serves this purpose for table rows.

---

## Intent-Based Route Prefetching

**File:** `lib/performance/PrefetchOnIntentLink.tsx`

A reusable internal link wrapper that prefetches route segments when the user signals intent to navigate — earlier than the default Next.js prefetch behaviour:

```typescript
// Prefetch triggers
- onMouseEnter  (hover)
- onFocus       (keyboard navigation)
- onTouchStart  (mobile tap intent)
```

Guards are in place to prevent duplicate prefetch calls when the user lingers on a link or navigates back to the same route.

Used broadly in public navigation and book catalog links where prefetching the destination route segment improves perceived navigation speed.

For the navigation loading bar that complements prefetching, see [Top Loader Navigation](Top_Loader_Navigation.md).

---

## LCP Image Optimisation

**File:** `lib/performance/lcp.ts`

Centralises responsive image size definitions for the two most LCP-critical surfaces:

- **Auth illustrations** — the sign-in and sign-up page hero images
- **Book cover rendering** — `BookCover` component across catalog and detail views

```typescript
// lib/performance/lcp.ts
export const AUTH_ILLUSTRATION_SIZES = "(max-width: 768px) 100vw, 50vw";

export const BOOK_COVER_SIZES = {
  catalog: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw",
  detail:  "(max-width: 768px) 100vw, 40vw",
};
```

Providing accurate `sizes` to `<Image>` ensures the browser downloads the appropriately sized source image rather than fetching a larger one and scaling it down, reducing LCP payload.

---

## Search and Pagination URL Construction

**File:** `lib/performance/navigation.ts`

Provides `buildSearchHref` and `buildPaginationPages` to ensure search and pagination URLs are assembled consistently across all components. This eliminates ad-hoc URL construction that can produce inconsistent query strings or drop active filter parameters.

For full documentation see [Cache and Search Consistency — Search Route and Pagination URLs](Cache_and_Search_Consistency.md#search-route-and-pagination-urls).

---

## Admin Table Optimisations

The following admin-table changes were introduced in the same set of improvements. They are documented in full in [Admin Dashboard Optimization](Admin_Dashboard_Optimization.md):

- `PartialTableWrapper` — headers stay visible during body suspension
- `RowSkeleton` — row-level loading placeholders
- `AdminSearchClient` + `SearchContext` — shared, debounced search and sort state
- `BorrowTable` optimistic updates — per-row pending state with rollback
- `lib/admin/actions/borrow.ts` query — pages `borrow_records` before joining `books` and `users`
- `AdminDashboardRealtime` — lazy-loads non-critical dashboard sections

---

## Borrow Status API Compatibility

**Files:** `app/api/book/requests/[id]/approve/route.ts`, `reject/route.ts`, `return/route.ts`

Borrow status mutation routes were updated to use **single-statement atomic SQL** (CTE-based) instead of `db.transaction()`, which is not supported by the Neon HTTP driver (`drizzle-orm/neon-http`).

This change is required for correctness on the current infrastructure — it is not optional. It keeps status transitions and counter updates atomic without requiring a heavier database client. See [Database — Atomic approve/reject/return on Neon HTTP](Database.md#atomic-approverejecreturn-on-neon-http).

---

## Impact Summary

| Area | Change | Benefit |
|---|---|---|
| Client bundle | Lazy-load `FileUpload`, `ReceiptModal`, `ImageCropper`, `ColorPicker` | Reduced initial JS for non-critical components |
| Navigation | `PrefetchOnIntentLink` on internal links | Earlier route segment prefetch on hover/focus/touch |
| LCP | Centralised `sizes` for auth illustrations and book covers | Correctly sized image downloads; better LCP scores |
| Search / pagination URLs | `buildSearchHref`, `buildPaginationPages` | Consistent URL construction; no dropped filter params |
| Admin table loading | `PartialTableWrapper` + `RowSkeleton` | Stable headers; reduced layout shift |
| Admin search | `SearchContext` with debounce | Shared state across sections; fewer redundant fetches |
| Admin borrow UX | Optimistic per-row status updates | Near-instant feedback; rollback on failure |
| Admin borrow query | Paginate first, then join | Reduced join cost under large datasets |
| Dashboard load | Deferred non-critical sections | Faster initial dashboard paint |
| Borrow status writes | Single-statement CTE | Neon HTTP driver compatibility; atomic updates |

---

## Notes

- Components using lazy imports must handle loading states gracefully. The `Suspense` fallback should match the final component's dimensions to avoid layout shift.
- `searchBooks` routes through `searchBooksCached` by default. Use `searchBooksUncached` only when a cache bypass is explicitly required (e.g. admin preview after mutation).
- `BookCover` depends on `BOOK_COVER_SIZES` from `lcp.ts` for consistent rendering across catalog and detail views. Do not hardcode `sizes` in individual `BookCover` usages.

---

## Related Files

- `lib/performance/bundle.tsx` — lazy component exports
- `lib/performance/PrefetchOnIntentLink.tsx` — intent-based prefetch link
- `lib/performance/lcp.ts` — responsive image size constants
- `lib/performance/navigation.ts` — `buildSearchHref`, `buildPaginationPages`
- `lib/performance/cache.ts` — cached query helpers (see [Cache and Search Consistency](Cache_and_Search_Consistency.md))
- `lib/performance/top-loader.ts` — NProgress controller (see [Top Loader Navigation](Top_Loader_Navigation.md))
- `components/admin/PartialTableWrapper.tsx`
- `components/admin/skeleton/RowSkeleton.tsx`
- `components/admin/AdminSearchClient.tsx`
- `components/admin/context/SearchContext.tsx`
- `components/admin/dashboard/AdminDashboardRealtime.tsx`
- `lib/admin/actions/borrow.ts`
- `app/api/book/requests/[id]/approve/route.ts`
- `app/api/book/requests/[id]/reject/route.ts`
- `app/api/book/requests/[id]/return/route.ts`
