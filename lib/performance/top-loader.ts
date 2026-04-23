"use client";

import NProgress from "nprogress";

type NavigationMethod = "push" | "replace";

type RouterNavigationOptions = {
  scroll?: boolean;
};

type ProgressRouter = {
  push: (href: string, options?: RouterNavigationOptions) => void;
  replace: (href: string, options?: RouterNavigationOptions) => void;
};

const MIN_VISIBLE_MS = 420;
const FINISH_DELAY_MS = 160;
const CLICK_BUMP = 0.08;
const ROUTE_COMMIT_PROGRESS = 0.82;
// If no route commit arrives within this window, force-complete the bar.
// This covers the case where Next.js serves from cache and never triggers
// a pathname/searchParams change, so handleRouteReady() is never called.
const NAVIGATION_TIMEOUT_MS = 5000;

let isConfigured = false;
let isNavigating = false;
let navigationStartedAt = 0;
let navigationSequence = 0;
let finishTimeout: number | null = null;
let paintFrame: number | null = null;
let navigationSafetyTimeout: number | null = null; // ← NEW

const ensureConfigured = () => {
  if (isConfigured) {
    return;
  }

  NProgress.configure({
    showSpinner: false,
    minimum: 0.12,
    trickle: true,
    trickleSpeed: 180,
  });

  isConfigured = true;
};

const clearPendingCompletion = () => {
  if (paintFrame !== null) {
    window.cancelAnimationFrame(paintFrame);
    paintFrame = null;
  }

  if (finishTimeout !== null) {
    window.clearTimeout(finishTimeout);
    finishTimeout = null;
  }
};

// ← NEW: clears the safety net without completing
const clearNavigationSafety = () => {
  if (navigationSafetyTimeout !== null) {
    window.clearTimeout(navigationSafetyTimeout);
    navigationSafetyTimeout = null;
  }
};

const isModifiedEvent = (
  event: MouseEvent | React.MouseEvent<HTMLAnchorElement>,
) => event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

const getCurrentRoute = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.pathname}${window.location.search}`;
};

const getRouteFromHref = (href: string) => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const target = new URL(href, window.location.href);

    if (target.origin !== window.location.origin) {
      return null;
    }

    return `${target.pathname}${target.search}`;
  } catch {
    return null;
  }
};

export const shouldStartProgressForAnchorClick = (
  anchor: HTMLAnchorElement,
  event?: MouseEvent | React.MouseEvent<HTMLAnchorElement>,
) => {
  if (event?.defaultPrevented) {
    return false;
  }

  if (event && "button" in event && event.button !== 0) {
    return false;
  }

  if (event && isModifiedEvent(event)) {
    return false;
  }

  if (anchor.target && anchor.target !== "_self") {
    return false;
  }

  if (anchor.hasAttribute("download")) {
    return false;
  }

  const href = anchor.href;
  const targetRoute = getRouteFromHref(href);

  if (!href || !targetRoute) {
    return false;
  }

  return targetRoute !== getCurrentRoute();
};

const forceComplete = () => {
  NProgress.done();
  isNavigating = false;
  finishTimeout = null;
  paintFrame = null;
  clearNavigationSafety(); // ← NEW: always clean up safety net on completion
};

export const startTopLoader = (targetRoute?: string | null) => {
  if (typeof window === "undefined") {
    return false;
  }

  const resolvedTarget =
    targetRoute === undefined ? null : (targetRoute ?? getCurrentRoute());

  if (resolvedTarget && resolvedTarget === getCurrentRoute()) {
    return false;
  }

  ensureConfigured();
  clearPendingCompletion();
  clearNavigationSafety(); // ← NEW: reset safety net on each new navigation

  navigationSequence += 1;

  if (!isNavigating) {
    isNavigating = true;
    navigationStartedAt = window.performance.now();
    NProgress.start();

    // ← NEW: arm the safety net — if completeTopLoader is never called
    // (e.g. Next.js cache hit doesn't update pathname), force-complete.
    const safetySequence = navigationSequence;
    navigationSafetyTimeout = window.setTimeout(() => {
      navigationSafetyTimeout = null;
      // Only fire if this navigation is still the active one and never completed
      if (isNavigating && navigationSequence === safetySequence) {
        forceComplete();
      }
    }, NAVIGATION_TIMEOUT_MS);

    return true;
  }

  // Already navigating — bump progress and reset the safety net for the
  // new sequence so it gets its own fresh timeout window.
  const safetySequence = navigationSequence;
  navigationSafetyTimeout = window.setTimeout(() => {
    navigationSafetyTimeout = null;
    if (isNavigating && navigationSequence === safetySequence) {
      forceComplete();
    }
  }, NAVIGATION_TIMEOUT_MS);

  NProgress.inc(CLICK_BUMP);
  return false;
};

export const startTopLoaderForHref = (href: string) => {
  const targetRoute = getRouteFromHref(href);

  if (!targetRoute) {
    return false;
  }

  return startTopLoader(targetRoute);
};

export const bumpTopLoaderForRouteCommit = () => {
  if (typeof window === "undefined") {
    return;
  }

  ensureConfigured();

  if (!isNavigating) {
    isNavigating = true;
    navigationStartedAt = window.performance.now();
    NProgress.start();
  }

  if ((NProgress.status ?? 0) < ROUTE_COMMIT_PROGRESS) {
    NProgress.set(ROUTE_COMMIT_PROGRESS);
  }
};

export const completeTopLoader = () => {
  if (typeof window === "undefined") {
    return;
  }

  // If nothing is navigating, make sure any lingering bar is cleaned up.
  if (!isNavigating) {
    if (NProgress.status !== null) {
      forceComplete();
    }
    return;
  }

  const completionSequence = navigationSequence;

  clearPendingCompletion();

  const finishAfterPaint = () => {
    paintFrame = window.requestAnimationFrame(() => {
      paintFrame = window.requestAnimationFrame(() => {
        const elapsed = window.performance.now() - navigationStartedAt;
        const remainingVisibleTime = Math.max(MIN_VISIBLE_MS - elapsed, 0);

        finishTimeout = window.setTimeout(() => {
          finishTimeout = null;
          paintFrame = null;

          if (completionSequence !== navigationSequence) {
            // Newer navigation owns the bar — but rescue if it's been abandoned
            if (paintFrame === null && finishTimeout === null) {
              forceComplete();
            }
            return;
          }

          forceComplete();
        }, remainingVisibleTime + FINISH_DELAY_MS);
      });
    });
  };

  finishAfterPaint();
};

export const navigateWithTopLoader = (
  router: ProgressRouter,
  method: NavigationMethod,
  href: string,
  options?: RouterNavigationOptions,
) => {
  const started = startTopLoaderForHref(href);

  try {
    router[method](href, options);
  } catch (error) {
    if (started) {
      clearPendingCompletion();
      forceComplete();
    }
    throw error;
  }
};
