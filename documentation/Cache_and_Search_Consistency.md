# Cache and Search Consistency

This document covers the uncommitted caching and data consistency logic changes.

## New caching layer

- Added `lib/performance/cache.ts`.
  - Defines `CACHE_TAGS` for `books` and `users`.
  - Defines revalidation intervals for books, search, and user state.
  - Adds cached helpers:
    - `getLatestBooksCached`
    - `getBookByIdCached`
    - `getSimilarBooksCached`
    - `getBorrowingEligibilityCached`
    - `searchBooksCached`

- Updated `lib/essentials/searchQuery.ts`.
  - Routes `searchBooks` through the cached search helper.
  - Preserves an uncached fallback path in `searchBooksUncached`.

## Cache invalidation on mutations

- Updated admin and app actions to revalidate tags after dataset changes.
  - `lib/actions/book.ts` revalidates `books` and `users` after borrow/dismiss operations.
  - `lib/admin/actions/book.ts` revalidates `books` on create/update/delete.
  - `lib/admin/actions/borrow.ts` revalidates both `books` and `users` after status changes or clear operations.
  - `lib/admin/actions/user.ts` revalidates `users` after approval, rejection, deletion, and role updates.
  - `app/api/avatar/route.ts` revalidates `users` after avatar updates.

## Search and route behavior

- Added `lib/performance/navigation.ts` for building search and pagination URLs.
- Updated `components/SearchForm.tsx` to use native `GET` form submission and preserve filter state.
- Updated `components/SearchFilter.tsx` to use `router.replace` with transitions and preserve the current query.

## Admin dashboard data fetching

- `lib/admin/dashboard.ts` now runs dashboard queries in parallel using `Promise.all`.
- New dashboard sections use server components and shared data fetch wrappers.

## Benefits

- Faster repeated search and book detail loads.
- Improved consistency between admin mutations and public cache state.
- Better search route maintenance and pagination URL generation.

## Testing considerations

- Ensure cache tags invalidate correctly after book/borrow/user updates.
- Validate search results remain current after content mutations.
- Confirm search route URLs behave consistently across filters and pages.
