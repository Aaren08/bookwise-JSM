# Top Loader Navigation

This document explains the app-wide top loading bar built with `nprogress` for BookWise. The loader is part of the broader performance layer described in [Performance Improvements](Performance_Improvements.md). For intent-based route prefetching (which pairs with the loader), see the `PrefetchOnIntentLink` section in [Performance Improvements](Performance_Improvements.md#intent-based-route-prefetching).

---

## Overview

The top loader is designed to feel immediate and smooth during client-side navigation:

- Starts on link click **before** the route transition begins
- Keeps progressing while navigation is in flight
- Finishes only after the destination route has committed and the new UI has painted
- Avoids restarting on repeated clicks or same-route navigations
- Handles browser back and forward navigation

---

## Files Involved

| File | Role |
|---|---|
| `components/TopLoader.tsx` | Global client-side observer for click, route-change, and history events |
| `lib/performance/top-loader.ts` | Shared NProgress controller and navigation helper utilities |
| `lib/performance/PrefetchOnIntentLink.tsx` | Reusable internal link wrapper that prefetches on hover/focus/touch intent |
| `components/SearchFilter.tsx` | Uses `navigateWithTopLoader` for query-string route replacement |
| `components/AuthForm.tsx` | Uses `navigateWithTopLoader` for post-login navigation |
| `components/admin/forms/BookForm.tsx` | Uses `navigateWithTopLoader` for post-submit route navigation |
| `app/(root)/layout.tsx` | Mounts `<TopLoader />` in the main protected app layout |
| `app/styles/globals.css` | Customises the `nprogress` bar appearance |

---

## Synchronisation Model

### 1. Click Detection

`components/TopLoader.tsx` listens for document-level anchor clicks in the **capture phase** (before any element handler fires).

Before starting the loader, it checks:

- The click is a primary left-click (button 0)
- No modifier keys are held (`Ctrl`, `Shift`, `Meta`, `Alt`)
- The link is internal (same origin)
- The link is not a download (`download` attribute absent)
- The link target is not opening in a new tab/window (`target !== "_blank"`)
- The destination differs from the current route (same-route navigations are skipped)

If all checks pass, `startTopLoaderForHref()` is called immediately on click.

### 2. Route Change Detection

`TopLoader` also subscribes to:

- `usePathname()` — detects `pathname` changes
- `useSearchParams()` — detects query string changes

When either changes, a composite route key (`pathname + searchParams`) is rebuilt. A change in this key signals that navigation has committed. At that point:

- `bumpTopLoaderForRouteCommit()` advances the bar toward completion
- `completeTopLoader()` is scheduled to finish the bar

### 3. Render Completion Timing

`completeTopLoader()` does not finish the bar immediately when the URL changes. It waits for:

- Two `requestAnimationFrame()` cycles (ensures the new route's content has had a chance to paint)
- A minimum visible duration (prevents the bar from disappearing before the user notices it)
- A small finish delay (smooths the visual transition)

This sequence ensures the bar finishes **after** the new UI renders, rather than the moment the URL updates.

---

## Shared Controller

`lib/performance/top-loader.ts` centralises all NProgress state so that multiple navigation sources (link clicks, form submissions, filter changes) remain consistent.

### Key Behaviours

- Configures `nprogress` once at module load time
- Tracks whether a navigation is already active to prevent duplicate starts
- Adds a small progress bump on rapid repeated clicks (instead of restarting)
- Cancels any pending completion if a newer navigation begins mid-flight
- Supports both click-driven and imperative `router.push` / `router.replace` navigation

### Exported Helpers

```typescript
// Guards whether a clicked anchor should start the loader
shouldStartProgressForAnchorClick(event: MouseEvent, href: string): boolean

// Starts the loader for a specific internal href (link clicks)
startTopLoaderForHref(href: string): void

// Starts the loader for generic navigations (popstate / back-forward)
startTopLoader(): void

// Advances progress after the new route has committed
bumpTopLoaderForRouteCommit(): void

// Finishes the loader after paint and smoothing delays
completeTopLoader(): void

// Wrapper around router.push() / router.replace() that also starts the loader
navigateWithTopLoader(
  router: AppRouterInstance,
  method: "push" | "replace",
  href: string,
  options?: NavigateOptions,
): void
```

---

## Reusable Link Pattern

`lib/performance/PrefetchOnIntentLink.tsx` is the standard internal link wrapper for the application. Its responsibilities are:

- **Prefetching** — calls `router.prefetch(href)` on hover, focus, or touch start
- **Loader start** — delegates to `startTopLoaderForHref()` on click via `TopLoader`'s document-level listener (no duplication — `PrefetchOnIntentLink` does not start the loader itself)

This separation keeps link behaviour consistent: prefetching is handled by the link component; loader control is handled globally by `TopLoader`.

---

## Imperative Navigation

Not all navigations originate from anchor clicks. Some come from form submissions, filter changes, and programmatic redirects. These use `navigateWithTopLoader`:

```typescript
// components/SearchFilter.tsx — filter change
navigateWithTopLoader(router, "replace", newHref);

// components/AuthForm.tsx — post-login redirect
navigateWithTopLoader(router, "push", "/");

// components/admin/forms/BookForm.tsx — post-submit redirect
navigateWithTopLoader(router, "push", "/admin/books");
```

Using `navigateWithTopLoader` keeps all imperative navigations aligned with link-based navigations so the bar behaviour is consistent regardless of how the route change is triggered.

---

## Edge Cases Handled

### Rapid Multiple Clicks

If the loader is already active when a second click arrives, it does not restart. Instead it increments slightly to preserve forward momentum and avoid a jarring reset.

### Same-Route Navigation

If the clicked `href` resolves to the current `pathname + searchParams`, the loader does not start. `shouldStartProgressForAnchorClick` returns `false` for this case.

### Back and Forward Navigation

`TopLoader` listens for the `popstate` event and calls `startTopLoader()` immediately, so browser history navigation also gets the loading bar treatment.

### External Links and New Tabs

The loader is skipped for:

- Links with a different origin
- Clicks with modifier keys held
- Non-primary-button clicks
- Links with `target` other than `_self`
- Links with the `download` attribute

---

## Styling

The `nprogress` bar is styled in `app/styles/globals.css`.

Current styling:

- **Height:** 4px top bar
- **Color:** warm orange gradient
- **Peg:** glowing right-edge indicator
- **Pointer events:** disabled (bar does not intercept clicks)
- **Transitions:** smooth transform and opacity easing

---

## Why This Works with App Router

The Next.js App Router does not expose `router.events` (which existed in the Pages Router). The top loader is synchronised instead by combining:

1. **Immediate click intent detection** — capture-phase listener starts the bar before the transition begins
2. **Route key observation** — `usePathname` + `useSearchParams` detects when navigation has committed
3. **Post-paint completion timing** — `requestAnimationFrame` + delays finish the bar after content renders

This gives a responsive, accurate loading experience without relying on any APIs that are unavailable in App Router.

---

## Maintenance Notes

- Mount `<TopLoader />` at a shared layout level (currently `app/(root)/layout.tsx`) so it can observe route changes across all protected pages.
- Use `PrefetchOnIntentLink` for internal navigation links wherever possible.
- Use `navigateWithTopLoader(router, "push" | "replace", href)` for all programmatic client-side navigations — never call `router.push` or `router.replace` directly in components that should show the loading bar.
- If new route groups are added, verify `TopLoader` is mounted in their layout if they contain client-navigable content.
- Do not call `NProgress` methods directly from components — always go through the shared helpers in `lib/performance/top-loader.ts` to keep state consistent.

---

## Related Documentation

- [Performance Improvements](Performance_Improvements.md) — bundle splitting, LCP, and prefetch link
- [Cache and Search Consistency](Cache_and_Search_Consistency.md) — `SearchFilter` uses `navigateWithTopLoader` alongside `router.replace`
- [Architecture](Architecture.md) — `TopLoader` listed in the components tree under `components/TopLoader.tsx`

## Related Files

- `components/TopLoader.tsx`
- `lib/performance/top-loader.ts`
- `lib/performance/PrefetchOnIntentLink.tsx`
- `components/SearchFilter.tsx`
- `components/AuthForm.tsx`
- `components/admin/forms/BookForm.tsx`
- `app/(root)/layout.tsx`
- `app/styles/globals.css`
