# Top Loader Navigation

This document explains the App Router top loading bar behavior built with `nprogress` for BookWise.

## Overview

The top loader is designed to feel immediate and smooth during client-side navigation:

- Start on link click before the route transition begins
- Keep progressing while navigation is in flight
- Finish only after the destination route has committed and the new UI has painted
- Avoid restarting on repeated clicks or same-route navigations
- Handle browser back and forward navigation

## Files Involved

- `components/TopLoader.tsx`
  - Global client-side observer for click, route-change, and history navigation events
- `lib/performance/top-loader.ts`
  - Shared NProgress controller and navigation helper utilities
- `lib/performance/PrefetchOnIntentLink.tsx`
  - Reusable internal link wrapper that prefetches routes on user intent
- `components/SearchFilter.tsx`
  - Uses the shared loader helper for query-string route replacement
- `components/AuthForm.tsx`
  - Uses the shared loader helper for post-login navigation and loader-aware links
- `components/admin/forms/BookForm.tsx`
  - Uses the shared loader helper for post-submit route navigation
- `app/(root)/layout.tsx`
  - Mounts the `TopLoader` component in the main protected app layout
- `app/styles/globals.css`
  - Customizes the `nprogress` bar appearance

## Synchronization Model

### 1. Click start

`components/TopLoader.tsx` listens for document-level anchor clicks in the capture phase.

Before starting the loader, it checks:

- The click is a primary left-click
- No modifier keys are pressed
- The link is internal
- The link is not a download
- The link target is not opening in a new tab/window
- The destination is different from the current route

If the navigation is valid, the loader starts immediately through `startTopLoaderForHref()`.

### 2. Route change

`TopLoader` also watches:

- `usePathname()`
- `useSearchParams()`

When either changes, a route key is rebuilt from:

```ts
pathname + searchParams
```

That route key is used to signal that navigation has committed. At that point:

- progress is bumped forward with `bumpTopLoaderForRouteCommit()`
- the loader is prepared to finish with `completeTopLoader()`

### 3. Render completion

The loader does not complete immediately when the URL changes.

Instead, `completeTopLoader()` waits for:

- two `requestAnimationFrame()` cycles
- a minimum visible duration
- a small finish delay

This ensures the bar finishes after the new UI has had a chance to paint, which makes the transition feel much more natural.

## Shared Controller

`lib/performance/top-loader.ts` centralizes all NProgress state so multiple navigation sources stay consistent.

### Key behaviors

- Configures `nprogress` once
- Tracks whether a navigation is already active
- Prevents duplicate starts
- Adds a small progress bump on rapid repeated clicks
- Cancels any pending completion if a newer navigation begins
- Supports both click-driven and imperative router navigation

### Main exported helpers

- `shouldStartProgressForAnchorClick()`
  - Guards whether a clicked anchor should start the loader
- `startTopLoader()`
  - Starts the loader for generic navigations such as `popstate`
- `startTopLoaderForHref()`
  - Starts the loader for a specific internal href
- `bumpTopLoaderForRouteCommit()`
  - Advances progress after the new route has committed
- `completeTopLoader()`
  - Finishes the loader after paint and smoothing delays
- `navigateWithTopLoader()`
  - Wrapper around `router.push()` and `router.replace()`

## Reusable Link Pattern

`lib/performance/PrefetchOnIntentLink.tsx` remains the reusable link wrapper for internal navigation.

Its job is to prefetch routes on:

- hover
- focus
- touch start

This keeps link behavior reusable while the loader start logic stays global in `TopLoader`, giving consistent behavior even if a route is triggered from different internal link shapes.

## Imperative Navigation Support

Not all navigations come from links. Some come from form submissions or filter changes.

Those flows use:

```ts
navigateWithTopLoader(router, "push" | "replace", href, options)
```

This keeps imperative navigations aligned with link-based navigations so the loading bar behavior stays consistent across the app.

## Edge Cases Handled

### Rapid multiple clicks

If the loader is already active, it does not restart. Instead, it increments slightly to preserve forward momentum.

### Same route navigation

If the clicked href resolves to the current pathname and search string, the loader does not start.

### Back and forward navigation

`TopLoader` listens to `popstate` and starts the loader immediately for browser history navigation.

### External links and new tabs

The loader is skipped for:

- external origins
- modified clicks
- non-primary clicks
- links with `target` other than `_self`
- download links

## Styling

The `nprogress` bar is styled in `app/styles/globals.css`.

Current styling includes:

- 4px top bar height
- warm orange gradient
- glowing peg
- pointer-events disabled
- smoother transform and opacity transitions

## Why This Works Well With App Router

The Next.js App Router does not expose `router.events`, so the loader is synchronized by combining:

- immediate click intent detection
- route key observation using `usePathname()` and `useSearchParams()`
- post-paint completion timing

This gives a responsive loading experience without relying on APIs that are unavailable in the App Router.

## Maintenance Notes

- Keep `TopLoader` mounted at a shared layout level where it can observe route changes globally.
- Use `PrefetchOnIntentLink` for internal links when possible.
- Use `navigateWithTopLoader()` for imperative client-side navigations.
- If additional route transitions are introduced, wire them through the shared helper rather than calling `NProgress` directly.
