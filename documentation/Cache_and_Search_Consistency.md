# Cache and Search Consistency

This document covers the caching layer, search query routing, and cache invalidation strategy for BookWise. For the broader architectural overview of how caching fits into the data flow, see [Architecture — Caching Strategy](Architecture.md#caching-strategy).

---

## Overview

BookWise uses Next.js tag-based caching with on-demand revalidation to serve fast repeated reads while keeping data consistent after mutations. Two primary cache tags drive all invalidation:

```typescript
// lib/performance/cache.ts
export const CACHE_TAGS = {
  books: "books",
  users: "users",
};
```

All cached query helpers are defined in `lib/performance/cache.ts` and wrap underlying Drizzle queries with `unstable_cache` (or equivalent Next.js caching primitives) tagged with one or both of these values.

---

## Cached Query Helpers

### Book Helpers

```typescript
getLatestBooksCached()
// Tags: ["books"]
// Used by: homepage featured books section

getBookByIdCached(id: string)
// Tags: ["books"]
// Used by: book detail page (/books/[id])

getSimilarBooksCached(bookId: string)
// Tags: ["books"]
// Used by: book detail page sidebar
// Also wrapped by getSimilarBooks() server action in lib/actions/book.ts

searchBooksCached(query: string, filters?: SearchFilters)
// Tags: ["books"]
// Used by: /search page via searchBooksUncached fallback
// See: Search Query Routing below
```

### User / Eligibility Helpers

```typescript
getBorrowingEligibilityCached(bookId: string, userId: string)
// Tags: ["books", "users"]
// Used by: BookOverview component to determine borrow button state
// Revalidated when either book counters or user status changes
```

---

## Cache Invalidation on Mutations

Every server action and API route that modifies relevant data calls `revalidateTag()` after the database write succeeds. The call sites are:

### Books Tag (`revalidateTag("books")`)

| File | Trigger |
|---|---|
| `lib/admin/actions/book.ts` | `createBook()`, `updateBook()`, `deleteBook()` |
| `lib/actions/book.ts` | `borrowBook()` (after reserving a copy) |
| `lib/admin/actions/borrow.ts` | Any borrow status change (approve, reject, return, expire) |
| `app/api/book/cron/expire-reservations/route.ts` | After bulk-expiring stale reservations |

### Users Tag (`revalidateTag("users")`)

| File | Trigger |
|---|---|
| `lib/actions/book.ts` | `borrowBook()`, `dismissBorrowRecord()` |
| `lib/admin/actions/borrow.ts` | Any borrow status change |
| `lib/admin/actions/user.ts` | `approveAccount()`, `rejectAccount()`, `deleteUser()`, `updateUserRole()` |
| `app/api/avatar/route.ts` | After avatar update |

### Both Tags

`borrowBook()` and all borrow status change actions revalidate both tags because a status change affects both book counters (books tag) and the user's borrow history (users tag).

---

## Search Query Routing

```typescript
// lib/essentials/searchQuery.ts
export const searchBooks = async (query: string, filters?: SearchFilters) => {
  return searchBooksCached(query, filters);
};

// Uncached fallback — used when cache bypass is needed (e.g. admin preview)
export const searchBooksUncached = async (query: string, filters?: SearchFilters) => {
  return db.select().from(books).where(buildSearchWhere(query, filters));
};
```

`searchBooks` routes through `searchBooksCached` by default. The uncached path (`searchBooksUncached`) is available for contexts where stale results would be misleading — for example, immediately after an admin creates a book and wants to verify it appears in search without waiting for cache revalidation.

The search cache is revalidated together with the `books` tag, so any book create/update/delete will cause the next `searchBooksCached` call to re-execute the database query.

---

## Search Route and Pagination URLs

`lib/performance/navigation.ts` provides helpers for building consistent search and pagination URLs:

```typescript
// Build a search route href with all active parameters
buildSearchHref({ query, genre, page, sort })
// e.g. /search?query=tolkien&genre=Fantasy&page=2&sort=rating

// Generate a page number list with ellipsis handling
buildPaginationPages(currentPage, totalPages)
// e.g. [1, 2, "...", 8, 9, 10] for currentPage=9, totalPages=10
```

These are used by `SearchFilter` and the pagination component to ensure URL parameters are constructed consistently rather than being assembled ad-hoc in individual components.

---

## Search Form Behaviour

### `components/SearchForm.tsx`

Uses native `GET` form submission so the browser constructs the search URL directly from the form inputs. This preserves the current filter state in the URL on every search without requiring JavaScript-driven routing.

### `components/SearchFilter.tsx`

Uses `router.replace` with React transitions when the user changes a filter (genre, sort order). The current search query is preserved when switching filters:

```typescript
// Preserve the existing query param while updating genre
const newHref = buildSearchHref({
  query: currentQuery,
  genre: selectedGenre,
  page:  1,            // reset to page 1 on filter change
  sort:  currentSort,
});
startTransition(() => router.replace(newHref));
```

Using `router.replace` (not `router.push`) means filter changes do not create new browser history entries, keeping the back button behaviour clean.

---

## Admin Dashboard Data Fetching

`lib/admin/dashboard.ts` runs all dashboard queries **in parallel** using `Promise.all`:

```typescript
const [
  totalBooks,
  totalUsers,
  borrowedBooks,
  pendingRequests,
  recentActivity,
] = await Promise.all([
  getTotalBooks(),
  getTotalUsers(),
  getBorrowedBooksCount(),
  getPendingRequestsCount(),
  getRecentActivity(),
]);
```

This reduces dashboard load time compared to sequential awaits, particularly when individual queries have non-trivial latency under load.

Dashboard data is not served from the tag-based cache — it is fetched fresh on every request to `GET /api/admin/dashboard` and refreshed via the realtime signal-and-fetch pattern. See [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md).

---

## Revalidation Intervals

Some helpers define explicit revalidation intervals as a secondary freshness guarantee:

```typescript
// lib/performance/cache.ts
export const REVALIDATION_INTERVALS = {
  books:  3600,   // 1 hour
  search: 1800,   // 30 minutes
  users:  3600,   // 1 hour
};
```

These intervals act as a safety net — if a mutation somehow fails to call `revalidateTag()`, cached data will still refresh within the defined window. The primary invalidation mechanism is always the explicit `revalidateTag()` call at each mutation site.

---

## Benefits

- **Faster repeated reads** — book detail pages and search results are served from the cache on subsequent requests without hitting the database
- **Consistent public state** — every admin mutation (approve, reject, create book, etc.) immediately invalidates the affected cache tags, so public users see fresh data on their next request
- **Targeted invalidation** — using two tags rather than one allows book-only mutations to avoid invalidating user-related caches and vice versa
- **Predictable URL structure** — `buildSearchHref` ensures search and pagination links are consistent across components

---

## Testing Considerations

- Verify cache tags invalidate correctly after book create, update, and delete operations
- Verify cache tags invalidate after borrow status changes (approve, reject, return, expire)
- Verify user cache invalidates after avatar update, account approval/rejection, and role change
- Confirm search results reflect content mutations without requiring a full server restart
- Confirm `SearchFilter` preserves the current query string when changing genre or sort
- Confirm pagination URLs use `buildSearchHref` consistently and include all active filter params

---

## Related Documentation

- [Architecture — Caching Strategy](Architecture.md#caching-strategy)
- [Admin Dashboard Optimization](Admin_Dashboard_Optimization.md) — paginated borrow query optimisation
- [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md) — dashboard data freshness via SSE
- [Borrowing System](Borrowing_System.md) — which mutations trigger cache revalidation
- [Top Loader Navigation](Top_Loader_Navigation.md) — `navigateWithTopLoader` used alongside `router.replace` in filter changes
- [Performance Improvements](Performance_Improvements.md) — bundle splitting and LCP optimisations

## Related Files

- `lib/performance/cache.ts` — `CACHE_TAGS`, revalidation intervals, all cached helpers
- `lib/performance/navigation.ts` — `buildSearchHref`, `buildPaginationPages`
- `lib/essentials/searchQuery.ts` — `searchBooks`, `searchBooksUncached`
- `components/SearchForm.tsx` — native GET form submission
- `components/SearchFilter.tsx` — `router.replace` with transition on filter change
- `lib/admin/dashboard.ts` — parallel dashboard query execution
- `lib/actions/book.ts` — `borrowBook`, `dismissBorrowRecord` revalidation
- `lib/admin/actions/book.ts` — book CRUD revalidation
- `lib/admin/actions/borrow.ts` — borrow status change revalidation
- `lib/admin/actions/user.ts` — user management revalidation
- `app/api/avatar/route.ts` — avatar update revalidation
