# BookWise E2E Testing Guide

> Production-grade documentation for the BookWise end-to-end test suite.
> Maintained by the BookWise Engineering Team.

---

## Table of Contents

1. [Testing Philosophy](#1-testing-philosophy)
2. [Current Testing Architecture](#2-current-testing-architecture)
3. [Test Categorization Rules](#3-test-categorization-rules)
4. [Critical User Journeys](#4-critical-user-journeys)
5. [Playwright Best Practices](#5-playwright-best-practices)
6. [Reliability & Stability Standards](#6-reliability--stability-standards)
7. [Environment & Configuration](#7-environment--configuration)
8. [CI/CD Testing Workflow](#8-cicd-testing-workflow)
9. [Debugging & Failure Analysis](#9-debugging--failure-analysis)
10. [Future Testing Expansion](#10-future-testing-expansion)
11. [Test Writing Guidelines](#11-test-writing-guidelines)
12. [Regression Testing Strategy](#12-regression-testing-strategy)
13. [Testing Checklist Before Every PR](#13-testing-checklist-before-every-pr)
14. [Common E2E Anti-Patterns](#14-common-e2e-anti-patterns)
15. [Definition of a Good E2E Test](#15-definition-of-a-good-e2e-test)

---

## 1. Testing Philosophy

### Why E2E Testing Exists Here

BookWise is a library management system handling authentication, role-based access control, book borrowing lifecycle, real-time SSE-driven admin dashboards, file uploads, and financial-grade receipts. These features cannot be adequately validated through unit tests alone. E2E tests provide:

- **Browser-level confidence** that the application works as a cohesive system
- **Real-time protocol verification** (SSE, WebSocket-adjacent streaming)
- **Multi-actor scenario coverage** (user borrows → admin approves → real-time propagation)
- **Upload/crop pipeline integrity** (file chooser → cropper → ImageKit mock → avatar API)
- **Session invalidation and security boundary enforcement**

### Business Risks Protected

| Risk                                            | E2E Coverage                                              |
| ----------------------------------------------- | --------------------------------------------------------- |
| Auth bypass leading to unauthorized data access | Session invalidation, protected route tests               |
| Borrow lifecycle data corruption                | Full lifecycle spec (borrow → approve → receipt → return) |
| Admin dashboard showing stale metrics           | Real-time SSE propagation tests                           |
| Upload pipeline silently dropping files         | Avatar crop/upload/cancel/replace tests                   |
| Rate-limit failures allowing abuse              | Concurrency, throttling, SSE stream limit tests           |
| Security downgrade after admin demotion         | Multi-tab session invalidation, stale JWT tests           |
| System setup re-execution after initialization  | Post-setup guard tests, 409 conflict verification         |

### What MUST Always Be E2E

- **Authentication flows** (sign-up, sign-in, session persistence)
- **Protected route enforcement** (unauthenticated redirect, post-demotion redirect)
- **Multi-actor workflows** (admin approves user → user sees status change)
- **Real-time data propagation** (SSE-driven dashboard updates)
- **File upload pipelines** (file picker → crop → upload → API persistence)
- **Permission/role transitions** (admin demotion → immediate session invalidation)
- **Critical business transactions** (borrow → receipt generation → return)

### What MUST NEVER Be E2E

- **Pure UI component rendering variants** — use component tests or Storybook
- **Individual utility function logic** — use unit tests
- **Database query correctness** — use integration tests against the DB
- **API contract validation** — use contract tests or API-level integration tests
- **Visual regression** — use dedicated visual testing (Playwright snapshot or Percy)
- **Accessibility rule violations** — use dedicated aXe scans (we do this in E2E now, but should shift-left to component-level)

### Tradeoffs

| Dimension                         | Decision               | Rationale                                                                                         |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| Speed vs. Realism                 | Favor realism          | Mocks only third-party services (ImageKit). Real database, real Next.js server, real SSE streams. |
| Browser-level confidence vs. Cost | High confidence        | Accept longer test duration (2-4 min per spec). CI retries handle flakiness.                      |
| Isolation vs. Shared State        | Worker-level isolation | TEST_WORKER_INDEX in test data ensures parallel safety. DB state is seeded/cleaned per test.      |
| Mocking vs. Real APIs             | Mock external only     | ImageKit is mocked via page.route(). Internal APIs, DB, Redis are real.                           |

---

## 2. Current Testing Architecture

### Playwright Setup

- **Framework**: @playwright/test v1.60+
- **Configuration**: playwright.config.ts at project root
- **Test directory**: ./tests/e2e
- **Parallelism**: Fully parallel (fullyParallel: true)
- **Retries**: 2 on CI, 0 locally
- **Reporters**: HTML (persistent artifact) + List (console output)
- **Browser**: Chromium only (Desktop Chrome)
- **Trace**: on-first-retry
- **Screenshot**: only-on-failure
- **Video**: retain-on-failure
- **Web server**: npm run dev with SKIP_RATE_LIMIT=true
- **Base URL**: http://localhost:3000

### Folder Structure

```txt
tests/e2e/
├── config/
│   └── users.ts                      # Test user credentials for different roles
├── data/
│   ├── factories.ts                  # Test data generators (faker-based)
│   ├── avatar-id.png                 # Test image asset for avatar uploads
│   └── mock-id.png                   # Test image asset for ID card uploads
├── fixtures/
│   ├── base-fixture.ts               # Core fixture: signupPage, homePage + ImageKit mocks
│   ├── a11y-fixture.ts               # Extends base: AxeBuilder, Keyboard helper
│   ├── resilience-fixture.ts         # Extends base: consoleMonitor, failureSimulator,
│   │                                 #   networkInterceptor, adminContext/adminPage
│   ├── search-fixture.ts             # Extends base: searchTestId, searchPage + DB helpers
│   ├── setup-fixture.ts              # Extends base: accountPage, setupPage, dashboardPage
│   └── upload-fixture.ts             # Extends base: profilePage, cropper, networkInterceptor
├── helpers/
│   ├── cropper-helpers.ts            # Image cropper interaction (zoom, drag, save)
│   ├── generate-test-assets.ts       # Generates invalid test files (txt, pdf, html)
│   ├── network-helpers.ts            # NetworkInterceptor class for upload/avatar API mocking
│   ├── setup-helpers.ts              # DB reset, config verification, redirect capture
│   └── upload-helpers.ts             # Mock responses constants, wait helpers
├── pages/
│   ├── admin/
│   │   └── dashboard.page.ts         # Admin dashboard POM (stats, requests, SSE wait)
│   ├── auth/
│   │   ├── signin.page.ts            # Sign-in form POM with session-aware guard
│   │   └── signup.page.ts            # Sign-up form POM with file upload
│   ├── profile/
│   │   └── profile.page.ts           # User profile POM (avatar, crop, status)
│   ├── rate-limit/
│   │   └── too-fast.page.ts          # Rate-limit error page POM
│   ├── search/
│   │   └── search.page.ts            # SSR search POM (query, filter, pagination)
│   ├── system/
│   │   ├── account.page.ts           # First-time owner account creation POM
│   │   └── setup.page.ts             # System setup wizard POM
│   └── home.page.ts                  # Post-auth home page POM
├── tests/
│   ├── accessibility/
│   │   ├── keyboard.a11y.spec.ts     # Keyboard navigation verification
│   │   └── onboarding.a11y.spec.ts   # WCAG scan during onboarding flow
│   ├── admin/
│   │   ├── dashboard-realtime.spec.ts      # SSE dashboard (signup → borrow → approve → return)
│   │   ├── reconnect-resilience.spec.ts    # SSE reconnection after network interruption
│   │   ├── row-locking.spec.ts             # Admin concurrency lock mechanism
│   │   └── session-invalidation.spec.ts    # Demotion → SSE event → redirect → API block
│   ├── borrowing/
│   │   └── borrowing-lifecycle.spec.ts     # Full lifecycle across user + admin contexts
│   ├── onboarding/
│   │   ├── happy-path.spec.ts              # New user sign-up → admin approval → profile
│   │   └── edge-cases.spec.ts              # Invalid inputs, duplicate email, etc.
│   ├── rate-limiting/
│   │   ├── auth-throttling.spec.ts         # Sign-in rate limiting
│   │   ├── concurrency.spec.ts             # Burst request handling
│   │   ├── reset-window.spec.ts            # Window-based limit reset
│   │   └── sse-stream-limits.spec.ts       # SSE connection caps
│   ├── resilience/
│   │   ├── advanced-scenarios.spec.ts      # Complex failure combinations
│   │   ├── loading-states.spec.ts          # Skeleton/suspense behavior
│   │   ├── network-failure.spec.ts         # Offline → error state → recovery
│   │   ├── not-found.spec.ts               # 404 page rendering
│   │   ├── sse-recovery.spec.ts            # SSE reconnect with backoff
│   │   └── unauthorized-access.spec.ts     # Direct URL access without auth
│   ├── search/
│   │   ├── edge-cases.spec.ts              # Special characters, empty queries
│   │   ├── filter.spec.ts                  # Genre/author/availability filter
│   │   ├── pagination.spec.ts              # Page navigation, page-size boundaries
│   │   └── search.spec.ts                  # Title/author/genre search, case insensitivity
│   ├── system/
│   │   └── system-setup.spec.ts            # Full system initialization flow (serial)
│   └── upload/
│       ├── avatar-upload.spec.ts           # Crop → upload → verify → propagate
│       ├── university-card-upload.spec.ts  # ID card upload flow
│       ├── upload-failure-recovery.spec.ts # Upload interruption handling
│       └── upload-validation.spec.ts       # Invalid file rejection
└── utils/
    ├── resilience/
    │   ├── console-monitor.ts              # Captures console violations + server errors
    │   ├── failure-simulation.ts           # Network offline, blocking, delays, SSE abort
    │   ├── network-interception.ts         # Block/unblock/override API responses
    │   └── sse-reconnect-helpers.ts        # Reconnect stats, backoff verification
    ├── a11y.ts                             # AxeBuilder wrappers (full, scoped, rule-based)
    ├── borrowing.ts                        # DB seed/cleanup + sign-in for borrowing tests
    ├── browser-fetch.ts                    # In-browser fetch wrappers (POST, concurrent)
    ├── concurrency.ts                      # Rate limit analysis, batch requests
    ├── keyboard.ts                         # Keyboard navigation class (tab, focus)
    ├── lock.ts                             # Admin row lock API helpers + SSE lock events
    ├── rate-limit.ts                       # Redis reset, header validation, diagnostics
    └── sse.ts                              # SSE interceptor script, event/connection queries
```

### Fixture Architecture

Fixtures follow an inheritance chain. Each layer adds capabilities:

```txt
@playwright/test (base)
└── base-fixture.ts
    ├── signupPage (with ImageKit mocks)
    ├── homePage
    ├── a11y-fixture.ts
    │   ├── makeAxeBuilder (WCAG 2.0/2.1 AA)
    │   └── keyboard
    ├── search-fixture.ts
    │   ├── searchTestId (unique per test)
    │   └── searchPage
    └── setup-fixture.ts
        ├── accountPage (with ImageKit + next/image mocks)
        ├── setupPage
        └── dashboardPage
```

resilience-fixture.ts and upload-fixture.ts extend directly from @playwright/test (not base-fixture) because they need different mock combinations.

### Mocking Strategy

| External Dependency        | Mock Approach                                                      | Rationale                                    |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| ImageKit Auth              | page.route("\*\*/api/auth/imagekit") → static mock response        | No real API key in CI                        |
| ImageKit Upload            | page.route("https://upload.imagekit.io/**") → static mock response | Avoids network calls, enables parallel tests |
| Next.js Image Optimization | page.route("\*_/\_next/image_") → 1x1 px PNG                       | Prevents 404s from fake image URLs           |
| Session API                | Partial mock on POST only                                          | Preserves real GET behavior for auth         |

### Authentication Handling

- **Test users** are created directly in the database via beforeAll hooks
- **Sign-in** is performed through the real UI (SigninPage.signIn())
- **Multi-actor scenarios** use separate BrowserContext instances per role
- **Worker-indexed emails** ensure parallel isolation (${prefix}-@bookwise-test.com)
- **Post-setup users** use serial test mode to prevent parallel corruption

### SSE / Realtime Strategy

A custom EventSource interceptor script is injected via page.addInitScript() on admin pages. This script:

1. Wraps the native EventSource constructor
2. Captures every open, message, and error event into window.\_\_SSE_EVENTS[]
3. Tracks connection metadata in window.\_\_SSE_CONNECTIONS[]
4. Allows tests to poll these arrays for precise assertions

This avoids relying on timing-based waits and gives deterministic verification of real-time events.

### Network Diagnostics

Most resilience and critical-flow tests attach listeners for:

- **Console errors** (uncaught exceptions, React errors, hydration mismatches)
- **Request failures** (requestfailed events)
- **HTTP errors** (4xx/5xx responses)
- **Expected error filtering** (favicon, EventSource, AbortError, \_next/, \_rsc=)

These are collected throughout the test and asserted at the end to prove the application handles failures gracefully.

---

## 3. Test Categorization Rules

### Smoke Tests

**Purpose**: Verify critical paths work before deeper testing. Run on every commit.

**Naming**: \*.smoke.spec.ts (planned, not yet implemented)

**Current coverage (de facto smoke)**:

- onboarding/happy-path.spec.ts — complete user registration flow
- system/system-setup.spec.ts — full system initialization
- borrowing/borrowing-lifecycle.spec.ts — complete borrow lifecycle

**Priority**: P0 — must pass before any merge.

### Regression Tests

**Purpose**: Prevent reintroduction of previously fixed bugs.

**Naming**: \*.regression.spec.ts (planned) or inline with bug reference in title.

**Convention**: Every bug fix must include a test that fails without the fix. Test title must reference the issue number: "should reject duplicate email on sign-up (#1423".

**Priority**: P0 when linked to open bug. P1 otherwise.

### Happy Path Tests

**Purpose**: Verify the primary success flow through every feature.

**Naming**: \*.spec.ts with descriptive test title.

**Examples**:

- search/search.spec.ts — search by title, author, genre
- upload/avatar-upload.spec.ts — crop → upload → verify
- ate-limiting/auth-throttling.spec.ts — block after N attempts

**Priority**: P0 for core features, P1 for secondary features.

### Edge-Case Tests

**Purpose**: Verify boundary conditions, empty states, and invalid inputs.

**Naming**: \*edge-cases.spec.ts or test titles containing "empty", "invalid", "boundary".

**Examples**:

- search/edge-cases.spec.ts — special characters, extremely long queries
- upload/upload-validation.spec.ts — invalid file types, oversized files
- onboarding/edge-cases.spec.ts — duplicate email, missing fields

**Priority**: P1.

### Permission / Security Tests

**Purpose**: Verify role-based access control, protected routes, and session management.

**Naming**: Test titles containing "unauthorized", "redirect", "blocked", "invalidation".

**Examples**:

- admin/session-invalidation.spec.ts — demotion → SSE → redirect → API block
- resilience/unauthorized-access.spec.ts — direct URL access
- system/system-setup.spec.ts (tests 1, 2, 9-13) — pre/post-auth guards

**Priority**: P0 — security tests are non-negotiable.

### Accessibility Tests

**Purpose**: Verify WCAG 2.1 AA compliance using axe-core.

**Naming**: \*.a11y.spec.ts.

**Coverage**:

- accessibility/keyboard.a11y.spec.ts — full keyboard navigation
- accessibility/onboarding.a11y.spec.ts — WCAG scan throughout sign-up flow

**Tool**: @axe-core/playwright with tags wcag2a, wcag2aa, wcag21a, wcag21aa.

**Priority**: P1. Exemptions must be documented with disableRules.

---

## 4. Critical User Journeys

### Authentication Flows

| Journey               | File                                       | Why It Matters                                                 |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| New user sign-up      | onboarding/happy-path.spec.ts              | First interaction with the system; broken sign-up = zero users |
| Sign-in with redirect | search-fixture.ts (implicit in beforeEach) | Session management; broken sign-in = zero engagement           |
| Session persistence   | system/system-setup.spec.ts (test 8)       | Users expect to stay logged in across navigation               |

**Failure impact**: Users cannot access the application.

**Critical assertions**:

- Form submission leads to confirmation screen
- Admin approval propagates to user profile
- Redirect to home after sign-in
- Protected routes redirect to /sign-in

### Protected Routes

| Journey                               | File                                     | Why It Matters                 |
| ------------------------------------- | ---------------------------------------- | ------------------------------ |
| Unauthenticated access                | system/system-setup.spec.ts (tests 1, 2) | Security baseline              |
| Post-demotion redirect                | admin/session-invalidation.spec.ts       | Real-time security enforcement |
| Deep-link blocking                    |
| esilience/unauthorized-access.spec.ts | URL manipulation resistance              |

**Failure impact**: Unauthorized data exposure.

**Critical assertions**:

- Redirect to /sign-in for anonymous access
- SSE session:invalidated event received
- /api/admin/\* endpoints return 401/403 after demotion

### CRUD Flows

| Journey                  | File                                  | Why It Matters              |
| ------------------------ | ------------------------------------- | --------------------------- |
| Book borrowing lifecycle | borrowing/borrowing-lifecycle.spec.ts | Core business transaction   |
| Book search              | search/search.spec.ts                 | Primary discovery mechanism |
| System setup             | system/system-setup.spec.ts           | Initial configuration       |

**Failure impact**: Business process failure.

**Critical assertions**:

- Borrow request creates PENDING record
- Receipt generation creates BORROWED record with correct dates
- Return restores book availability
- Search returns correct results by title, author, genre

### Uploads

| Journey                 | File                                   | Why It Matters                         |
| ----------------------- | -------------------------------------- | -------------------------------------- |
| Avatar crop and upload  | upload/avatar-upload.spec.ts           | User identity and profile completeness |
| University card upload  | upload/university-card-upload.spec.ts  | Identity verification                  |
| Upload validation       | upload/upload-validation.spec.ts       | Security (file type enforcement)       |
| Upload failure recovery | upload/upload-failure-recovery.spec.ts | UX resilience                          |

**Failure impact**: Corrupted user data, frustrated users.

**Critical assertions**:

- Cropper modal opens with correct controls
- Avatar URL updates after save
- Avatar propagates to header
- No full-page reload during upload
- Invalid files show error without crashing

### Search / Filtering

| Journey                | File                             | Why It Matters           |
| ---------------------- | -------------------------------- | ------------------------ |
| Title search           | search/search.spec.ts            | Primary book discovery   |
| Filter by genre/author | search/filter.spec.ts            | Refinement UX            |
| Pagination             | search/pagination.spec.ts        | Large catalog navigation |
| Empty state            | search/search.spec.ts (test 115) | UX completeness          |

**Failure impact**: Users cannot find books.

**Critical assertions**:

- Correct result count for exact title match
- Genre filter returns books in that genre
- Pagination navigates correctly
- "No Results Found" shown for non-existent terms
- URL reflects query parameters

### Real-Time Features (SSE)

| Journey                      | File                                  | Why It Matters                           |
| ---------------------------- | ------------------------------------- | ---------------------------------------- |
| Dashboard live updates       | admin/dashboard-realtime.spec.ts      | Admin trust in dashboard accuracy        |
| Book availability via SSE    | borrowing/borrowing-lifecycle.spec.ts | User sees immediate availability changes |
| Session invalidation via SSE | admin/session-invalidation.spec.ts    | Security enforcement without page reload |
| SSE reconnection             | admin/reconnect-resilience.spec.ts    | Resilience to transient network issues   |

**Failure impact**: Stale data, security window, frustrated users.

**Critical assertions**:

- dashboard:connected event received
- dashboard:refresh event after data mutation
- Stat counters update without page reload
- session:invalidated event triggers redirect
- SSE reconnects after network interruption

### Role / Permission Systems

| Journey                              | File                                          | Why It Matters                  |
| ------------------------------------ | --------------------------------------------- | ------------------------------- |
| Admin demotion → session invalidated | admin/session-invalidation.spec.ts            | Privilege escalation prevention |
| Multi-tab invalidation               | admin/session-invalidation.spec.ts (test 505) | All browser sessions terminated |
| Stale JWT enforcement                | admin/session-invalidation.spec.ts (test 626) | Token reuse prevention          |

**Failure impact**: Privilege escalation, data breach.

**Critical assertions**:

- Demoted admin receives SSE event and redirects to sign-in
- All open tabs redirect
- API endpoints return 401/403
- Back button does not restore admin access
- Session cookies are cleared

### Error States

| Journey                                      | File                  | Why It Matters |
| -------------------------------------------- | --------------------- | -------------- |
| Network failure during page load             |
| esilience/network-failure.spec.ts            | App stability offline |
| Failed server requests                       |
| esilience/network-failure.spec.ts (test 141) | Graceful degradation  |
| Toast notification spam                      |
| esilience/network-failure.spec.ts (test 177) | UX protection         |
| 404 page                                     |
| esilience/not-found.spec.ts                  | Error state rendering |

**Failure impact**: App crash, poor UX, support tickets.

**Critical assertions**:

- App does not crash on network failure
- Page remains on current URL (no redirect to sign-in)
- Limited toast count after repeated failures
- Navigation works after network restoration
- No uncaught exceptions

---

## 5. Playwright Best Practices

### Stable Selectors

Use semantic locators in this order of preference:

1. page.getByRole() — accessible name matching
2. page.getByLabel() — form label association
3. page.getByPlaceholder() — input placeholder text
4. page.getByText() — visible text content
5. page.getByAltText() — image alt attributes
6. page.getByTitle() — title attributes
7. page.locator('.css-class') — ONLY when semantic locators are impossible

` typescript
// GOOD — semantic, stable, accessible
page.getByRole("button", { name: "Sign Up", exact: true });
page.getByLabel("Email", { exact: true });
page.getByPlaceholder("Search for books...");

// BAD — brittle, implementation-coupled
page.locator("button.btn-primary");
page.locator("div > form > input:nth-child(2)");
page.locator('[data-testid="submit-btn"]');
`

### Avoid Brittle Locators

` typescript
// GOOD — resilient to DOM restructuring
page.getByRole("combobox").filter({ hasText: "Pending" });

// BAD — fragile, depends on exact structure
page.locator("tbody tr:nth-child(3) td:nth-child(2) .status-badge");
`

### Avoid Arbitrary Timeouts

` typescript
// GOOD — web-first assertion with built-in waiting
await expect(page.getByText("Success")).toBeVisible({ timeout: 10_000 });

// BAD — arbitrary sleep
await page.waitForTimeout(3000); // Never do this for synchronization
`

### Web-First Assertions

Always prefer Playwright's auto-retrying assertions over manual waiting:

` typescript
// GOOD — auto-retries until condition is met
await expect(locator).toBeVisible();
await expect(locator).toContainText("Expected");
await expect(locator).toHaveCount(3);

// BAD — manual wait + assertion
await page.waitForSelector(".result");
const text = await page.textContent(".result");
expect(text).toBe("Expected");
`

### Deterministic Tests

` typescript
// GOOD — explicit test data with unique prefix
const testRunId = e2e--;
await seedSearchBooks(testRunId);

// BAD — depends on existing database state
await page.goto("/search?query=test");
expect(await page.locator(".book-card").count()).toBe(5); // Unknown state
`

### Independent Tests

Every test must be able to run alone, in any order, and in parallel:

` typescript
// GOOD — self-contained setup and teardown
test.beforeEach(async ({ searchTestId }) => {
await signIn(page);
await seedSearchBooks(searchTestId);
});
test.afterEach(async ({ searchTestId }) => {
await cleanupSearchBooks(searchTestId);
});

// BAD — depends on previous test's side effects
test("create user", async () => { /_ ... _/ });
test("login as that user", async () => { /_ ... _/ }); // FAILS alone
`

Exception: Serial test suites ( est.describe.configure({ mode: "serial" })) are permitted for setup flows where each step builds on the previous. Used in system-setup.spec.ts and avatar-upload.spec.ts.

### Retry Philosophy

- **CI**: 2 retries configured globally. Flaky tests should be fixed, not hidden by retries.
- **Local**: 0 retries. If a test fails locally, it should fail consistently.
- **Per-test overrides**: Use est.retries(3) only when a test has a known unavoidable race (e.g., SSE timing).

### Parallel Execution Guidance

- All tests default to parallel execution (fullyParallel: true)
- Worker-indexed data (TEST_WORKER_INDEX) prevents collisions
- Tests modifying shared state (system setup) must use serial mode
- beforeAll/afterAll hooks are preferred over beforeEach/afterEach for expensive DB operations

---

## 6. Reliability & Stability Standards

### What Makes a Test Flaky

| Cause                | Example                       | Prevention                        |
| -------------------- | ----------------------------- | --------------------------------- |
| Race condition       | Click before handler attached | Use web-first assertions, waitFor |
| Network timing       | SSE event not yet received    | Use expect.poll() with timeout    |
| DB state collision   | Parallel tests share data     | Worker-indexed unique data        |
| CSS animation        | Click during transition       | waitFor the stable state          |
| Third-party resource | ImageKit real call failing    | Mock external services            |
| Async rendering      | React state not yet committed | waitFor, oBeVisible, oHaveText    |
| Browser-specific     | Test only passes in Chromium  | Use @skip-browser annotations     |

### Nondeterminism Prevention

1. **Always seed test data** — never depend on existing DB state
2. **Always clean up test data** — even on failure (afterAll with .catch(() => {}))
3. **Mock third-party services** — ImageKit, external APIs
4. **Use expect.poll() for dynamic content** — SSE events, URL changes via History API
5. **Avoid networkidle** — Next.js dev-mode WebSocket never settles; use domcontentloaded instead
6. **Worker-indexed data** — ${prefix}- prevents parallel test collisions
7. **Best-effort cleanup** — always wrap afterAll cleanup in .catch(() => {}) to avoid masking test failures

### Waiting Strategies

` typescript
// GOOD — web-first assertion (auto-waits up to timeout)
await expect(locator).toBeVisible({ timeout: 15_000 });

// GOOD — poll-based wait for dynamic content (SSE, URL changes)
await expect.poll(async () => {
const events = await getSseEvents(page);
return events.some(e => e.type === "message");
}, { timeout: 15_000 }).toBe(true);

// GOOD — wait for specific network response (upload completion)
await page.waitForResponse(
(response) => response.url().includes("upload.imagekit.io") && response.status() === 200,
{ timeout: 30_000 },
);

// GOOD — wait for URL change via History API (router.replace)
await expect(() => {
expect(new URL(page.url()).searchParams.get("page")).toBe("2");
}).toPass({ timeout: 10_000, intervals: [500] });

// BAD — arbitrary sleep
await page.waitForTimeout(5000);
`

### Race Condition Prevention

- **Click → Assert pattern**: Always wait for expected state after an action. Never chain actions without verification.
- **File upload → Crop modal**: Wait for cropper modal visible before clicking save/cancel buttons.
- **Navigation → Content**: Wait for content selector, not URL alone. waitForURL may resolve before SSR content renders.
- **SSE → State change**: Poll for the expected event array. Never assume the event arrived after a timeout.
- **Multi-actor tests**: Use separate BrowserContexts. Never share a page between roles.

### Optimistic UI Handling

When the app updates the UI before the server confirms:

`	typescript
// Assert local optimism AND server persistence
await expect(locator).toBeVisible();           // immediate optimistic update
await page.waitForResponse(...);               // server confirmation
await expect(locator).toBeVisible();           // still there after server response
`

### Debugging Methodology

When a test fails:

1. **Check the trace** — playwright-report/ contains trace files. Open with npx playwright show-trace.
2. **Check screenshots** — captured automatically on failure in est-results/.
3. **Check video** — recorded on failure in est-results/. Watch for visual glitches or unexpected navigation.
4. **Check test output** — the list reporter shows the exact line of failure.
5. **Re-run with --debug** — npx playwright test --debug opens the Playwright inspector.
6. **Filter console noise** — Expected errors (favicon, EventSource, AbortError) are filtered. Check the filtered set for real issues.
7. **Isolate the test** — Run the failing test alone: npx playwright test -g "test name".
8. **Check data collisions** — If the test uses shared DB data, ensure no other test targets the same records.

---

## 7. Environment & Configuration

### Required Environment Variables

`bash

# Auth / Session

AUTH_SECRET= # NextAuth secret
AUTH_URL=http://localhost:3000 # Required for NextAuth callbacks

# Database

DATABASE_URL= # PostgreSQL connection string

# Redis (Upstash) — for rate limiting

UPSTASH_REDIS_REST_URL= # REST URL
UPSTASH_REDIS_REST_TOKEN= # REST token

# ImageKit (required for app startup, mocked in tests)

NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT= # Public endpoint
IMAGEKIT_PUBLIC_KEY= # Public key
IMAGEKIT_PRIVATE_KEY= # Private key

# EmailJS (required for app startup, mocked in tests)

NEXT_PUBLIC_EMAILJS_SERVICE_ID= # Service ID
NEXT_PUBLIC_EMAILJS_TEMPLATE_ID= # Template ID
NEXT_PUBLIC_EMAILJS_PUBLIC_KEY= # Public key

# Rate Limiting

SKIP_RATE_LIMIT=true # Bypass rate limits in test env

# Test (optional overrides)

ADMIN_TEST_EMAIL= # Override admin test user email
ADMIN_TEST_PASSWORD= # Override admin test user password
USER_TEST_EMAIL= # Override user test email
USER_TEST_PASSWORD= # Override user test password
`

### Local Setup

`bash

# 1. Install dependencies

npm ci

# 2. Install Playwright browser (first time only)

npx playwright install chromium

# 3. Copy and fill environment

cp .env.example .env.local

# 4. Seed database

npm run seed

# 5. Run all tests

npx playwright test

# 6. Run with UI mode

npx playwright test --ui

# 7. Run a single test file

npx playwright test tests/e2e/tests/borrowing/borrowing-lifecycle.spec.ts

# 8. Run tests matching a pattern

npx playwright test -g "session invalidation"
`

### CI Setup

- **Provider**: GitHub Actions (.github/workflows/playwright.yml)
- **Trigger**: Push or PR to main/master
- **Timeout**: 60 minutes per job
- **Node**: LTS version
- **Steps**: Checkout →
  npm ci →
  npx playwright install --with-deps →
  npx playwright test → Upload playwright-report/ artifact (30-day retention)

### Browser Configuration

- **Single browser**: Chromium (Desktop Chrome viewport)
- **Headless**: Yes (CI default). Use npx playwright test --headed locally for visual debugging.
- **No mobile/tablet**: Not configured. Add projects for mobile viewports if responsive testing is needed.

### Base URLs

- **Local**: http://localhost:3000 (configured in playwright.config.ts)
- **Web server**: Auto-started via npm run dev with reuseExistingServer: !process.env.CI
- **CI**: The dev server is started fresh for each workflow run

### Test Users

- **Dynamic per-worker**: Most tests create users programmatically with worker-indexed emails
- **Static fallbacks**: config/users.ts contains hardcoded credentials for admin, standard user, and locked user
- **Every test seeds its own data**: Never depend on a pre-seeded user existing in the database

### Database Reset

- **System setup tests**: Explicitly reset DB state via resetToFreshState() which clears app_settings, setup events, and test-scoped users
- **Borrowing/search tests**: Clean up only their own data using worker-prefixed queries
- **Rate limit tests**: Reset Redis state via API (/api/test/reset-rate-limit) or direct Redis commands

---

## 8. CI/CD Testing Workflow

### What Runs on Pull Requests

| Stage           | Scope                        | When                             |
| --------------- | ---------------------------- | -------------------------------- |
| Full test suite | All `tests/e2e/**/*.spec.ts` | Every push/PR to `main`/`master` |
| Lint            | ESLint (`npm run lint`)      | Separate workflow (recommended)  |

### What Blocks Deployment

- **Any E2E test failure** — The full suite must pass.
- **Retries exhausted** — After 2 retries in CI, a persistent failure blocks the pipeline.
- **Playwright report uploaded on failure** — Allows debugging without blocking indefinitely.

### Recommended GitHub Actions Strategy

The current `.github/workflows/playwright.yml` runs all tests in a single job. For large teams, consider:

```yaml
# Future sharding strategy (when test count exceeds ~50 files)
jobs:
  test:
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright test --shard=${{ matrix.shard }}/4
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report-${{ matrix.shard }}
          path: playwright-report/
          retention-days: 7
```

### Fast Feedback Loops

| Strategy           | Implementation                                          | Benefit                                       |
| ------------------ | ------------------------------------------------------- | --------------------------------------------- |
| Sharding           | Split tests across N parallel CI runners                | Reduces wall-clock time from ~60min to ~15min |
| Smoke-only on push | Run smoke tests on every commit, full suite on PR merge | Immediate feedback for critical paths         |
| `--only-changed`   | Use Playwright's affected project detection             | Runs only tests related to changed files      |
| Fail-fast          | Stop on first failure in CI                             | Save runner minutes                           |

### Artifact Retention

| Artifact    | When                     | Retention   |
| ----------- | ------------------------ | ----------- |
| HTML Report | Always (even on success) | 30 days     |
| Screenshots | On failure only          | With report |
| Videos      | On failure only          | With report |
| Traces      | On first retry           | With report |

---

## 9. Debugging & Failure Analysis

### Playwright Trace Viewer

Traces are captured on the first retry (`trace: "on-first-retry"`). To view a trace:

```bash
npx playwright show-trace playwright-report/data/trace-*.zip
```

The trace viewer shows:

- **Timeline** — DOM snapshots at each action
- **Network** — All requests/responses with timing
- **Console** — All console messages
- **Source** — The test code that triggered each action

### Screenshots

Screenshots are captured on failure (`screenshot: "only-on-failure"`). Located in `test-results/`.

```bash
npx playwright show-report playwright-report/
```

### Videos

Videos are retained on failure (`video: "retain-on-failure"`). Watch for:

- Unexpected page navigations
- Modal flash/flicker
- Incomplete UI states before failure
- Loading spinners that never resolve

### Console Logging

Tests attach console listeners that capture:

- **`console.error`** — Application errors (check for React errors, 500 responses)
- **`pageerror`** — Uncaught exceptions in the page
- **Failed HTTP responses** — 4xx/5xx responses (excluding expected ones like favicon, EventSource)

These are collected into arrays and asserted at the end of critical tests. Expected errors are filtered out by known patterns (favicon, EventSource, AbortError, `_next/`, `_rsc=`).

### Network Inspection

The `network-interception.ts` utility and `FailureSimulator` class provide network debugging:

```typescript
const diag = createLockDiagnostics(page);
// ... run test actions ...
console.log(getLockDiagnosticSummary(diag));
// Output: "API calls: 12 (0 failed)"
```

### Reproduction Workflow

```text
1. Test fails in CI
   -> Download playwright-report artifact
   -> Open HTML report: npx playwright show-report playwright-report/
   -> Identify failing test, view trace
   -> Check if flaky: Re-run CI job
   -> If persistent: Run locally with --debug
   -> If only fails in CI: Check for:
      - DB state collisions (worker-prefix uniqueness)
      - Rate limiting (SKIP_RATE_LIMIT=true in CI?)
      - Timing differences (increase timeout)
      - Network dependencies (mocked in fixtures?)
```

### Isolating Flaky Tests

```bash
# Run with --repeat-each to reproduce flakiness
npx playwright test -g "test name" --repeat-each 5

# Run with --workers=1 to eliminate parallel interference
npx playwright test -g "test name" --workers=1

# Run with DEBUG=pw:api for protocol-level logging
DEBUG=pw:api npx playwright test -g "test name"
```

---

## 10. Future Testing Expansion

### What Should Move OUT of E2E Later

| Current E2E Coverage                                 | Future Home                           | Reason                                                |
| ---------------------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `keyboard.a11y.spec.ts` — tab order                  | Component-level test                  | Faster feedback, per-component focus management       |
| `onboarding.a11y.spec.ts` — WCAG scans               | Component test + Storybook a11y addon | axe-core runs faster per component than per page      |
| `rate-limiting/*` — token bucket logic               | API integration test                  | Pure HTTP request/response testing, no browser needed |
| `search/search.spec.ts` — result accuracy            | API integration test                  | Query against real DB via API, not browser            |
| `upload-validation.spec.ts` — file type              | Unit test                             | Input validation is pure logic, no browser needed     |
| `admin/reconnect-resilience.spec.ts` — SSE reconnect | Integration test                      | SSE stream can be tested at the HTTP level            |

### What Should Remain E2E Forever

| Test                                    | Why It Must Be E2E                                                  |
| --------------------------------------- | ------------------------------------------------------------------- |
| `admin/session-invalidation.spec.ts`    | Multi-actor, multi-tab, real-time SSE + redirect chain              |
| `borrowing/borrowing-lifecycle.spec.ts` | User + admin interaction across separate browser contexts           |
| `admin/dashboard-realtime.spec.ts`      | SSE propagation across user sign-up, borrow, approve, return        |
| `upload/avatar-upload.spec.ts`          | File chooser -> cropper modal -> ImageKit -> avatar API chain       |
| `system/system-setup.spec.ts`           | Multi-step wizard with redirect guards, DB persistence, UI branding |
| `network-failure.spec.ts`               | Browser-level network simulation (offline mode)                     |

### Unit Tests (Future)

**Scope**: Utility functions, validation schemas, pure computations.

**Framework**: Vitest or Jest.

**Location**: `tests/unit/` or co-located with source as `*.test.ts`.

**What to cover**:

- `lib/validations.ts` — Zod schema validation
- `lib/utils.ts` — Formatting helpers, date calculations
- `lib/emailjs.ts` — Template construction (mock EmailJS)
- `lib/config.ts` — Configuration parsing and defaults

### Integration Tests (Future)

**Scope**: API endpoints, database queries, server actions.

**Framework**: Vitest + supertest or Playwright API testing.

**Location**: `tests/integration/`.

**What to cover**:

- All `app/api/*` endpoints — request/response contracts
- Drizzle ORM queries — filtering, pagination, joins
- Server actions — borrow request creation, avatar update, setup completion
- Rate limiter integration — Upstash Redis interaction
- SSE endpoint behavior — connection lifecycle, event format

### Contract Tests (Future)

**Scope**: API contracts between frontend and backend.

**Approach**: Use `zod-to-json-schema` to generate OpenAPI specs, then run with `@playwright/test` API testing against dev server.

### Visual Regression Testing (Future)

**Scope**: Critical UI pages.

**Tools**: Playwright `expect().toHaveScreenshot()` or Percy.

**What to cover**:

- Admin dashboard (stat cards layout)
- Sign-in form
- Search results page
- Book detail page
- Receipt modal

### Recommended Test Pyramid for BookWise

```text
          /\
         /  \        E2E (30)
        /    \
       / E2E  \
      /--------\
     /          \    Integration / API (80)
    /            \
   /--------------\
  /                \  Unit (200+)
 /                  \
/--------------------\
```

---

## 11. Test Writing Guidelines

### File Naming

| Pattern                      | Example                        | When to Use                        |
| ---------------------------- | ------------------------------ | ---------------------------------- |
| `feature.spec.ts`            | `search.spec.ts`               | Happy path + general verification  |
| `feature-edge-cases.spec.ts` | `search-edge-cases.spec.ts`    | Edge cases, boundary conditions    |
| `feature.a11y.spec.ts`       | `keyboard.a11y.spec.ts`        | Accessibility scanning             |
| `feature.regression.spec.ts` | `borrowing.regression.spec.ts` | Bug regression tests (future)      |
| `feature.smoke.spec.ts`      | `onboarding.smoke.spec.ts`     | Critical path smoke tests (future) |

### Describe Blocks

```typescript
// GOOD — feature name as describe title
test.describe("Book Search", () => { ... });

// GOOD — sub-feature nesting
test.describe("Admin Dashboard Real-Time Updates", () => { ... });

// BAD — vague
test.describe("Test stuff", () => { ... });
```

### Test Titles

```typescript
// GOOD — describes behavior and expected outcome
test("search by exact title returns the correct single result", ...);
test("network disconnect during page load shows error state gracefully", ...);

// GOOD — includes issue reference for regression tests
test("should reject duplicate email on sign-up (#1423)", ...);

// BAD — vague
test("search works", ...);
test("Test 1", ...);
test("network stuff", ...);
```

### Assertions

```typescript
// GOOD — specific, semantic, web-first
await expect(page.getByText("Success")).toBeVisible();
await expect(locator).toContainText("Expected Value");
await expect(locator).toHaveCount(3);

// GOOD — poll-based for dynamic content
await expect
  .poll(async () => getStatValue(page, "Total Users"), { timeout: 15_000 })
  .toBe(42);

// BAD — non-web-first, manual waiting
await page.waitForSelector(".result");
const text = await page.textContent(".result");
expect(text).toBe("Expected Value");

// BAD — too vague
expect(result).toBeTruthy();
```

### Comments

```typescript
// GOOD — explains WHY (not what), documents tradeoffs
// Why we use expect.toPass instead of waitForURL:
// Next.js router.replace uses History API without triggering framenavigated.
// expect.toPass polls every 500ms, catching URL changes regardless of mechanism.

// BAD — explains what the code already says
// Click the submit button
await submitButton.click();
```

### Helper Abstractions

```typescript
// GOOD — encapsulates complex interaction with clear interface
async function assertReceiptModalContents(page: Page, params: {...}) { ... }

// GOOD — provides domain-specific language for test readers
await waitForDashboardConnected(adminPage);
await dashboardPage.expectStatValue("Total Users", expected, timeout);

// BAD — inline everything, duplicating logic across tests
const combobox = page.getByRole("combobox");
await expect(combobox).toContainText("Pending");
```

### Setup/Teardown

```typescript
// GOOD — beforeAll for expensive DB operations
test.beforeAll(async () => {
  await ensureUserExists();
  await ensureAdminExists();
  book = await seedTestBook();
});

// GOOD — afterAll with best-effort cleanup
test.afterAll(async () => {
  await cleanupTestBook().catch(() => {});
});

// BAD — beforeEach for expensive operations that don't change per test
test.beforeEach(async () => {
  await db.insert(users).values(...);  // Too slow — use beforeAll + cleanup isolation
});
```

### Data Factories

```typescript
// GOOD — generates unique, identifiable test data
const userData = generateUserData();
// userData.email = "jane.doe@playwright-test.com"  (identifiable domain)

// GOOD — unique prefix per test run for parallel safety
const testRunId = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// BAD — hardcoded data that collides in parallel runs
const email = "testuser@bookwise-test.com";
```

### Selector Conventions

```typescript
// GOOD — role/label/placeholder, exact matching
page.getByLabel("Email", { exact: true });
page.getByRole("button", { name: "Sign Up", exact: true });

// ACCEPTABLE — class selector when ARIA is impossible (shadcn Select)
page.locator(".select-trigger"); // commented explanation required

// BAD — fragile or ambiguous
page.locator("button"); // Which button?
page.locator("div.form-group input[type=text]"); // Implementation-coupled
```

### Anti-pattern Examples

```typescript
// ANTI-PATTERN: Multiple actions without verification
await page.fill("#email", "test@test.com");
await page.fill("#password", "password");
await page.click("button");

// PREFERRED: Step-by-step with verification per action
await page.getByLabel("Email").fill("test@test.com");
await page.getByLabel("Password").fill("password");
await page.getByRole("button", { name: "Login" }).click();

// ANTI-PATTERN: Shared mutable state between tests
let userId: string;
test("create user", async () => {
  userId = "abc";
});
test("use user", async () => {
  /* depends on userId from previous test */
});

// PREFERRED: Self-contained test data
test("full flow", async () => {
  const user = await createUser(); // local scope
  await doSomethingWith(user);
});
```

---

## 12. Regression Testing Strategy

### Bug → Regression Test Flow

Every bug fix must follow this process:

```text
1. Bug reported with reproduction steps
2. Developer writes E2E test that reproduces the bug
3. Test fails (proving the bug exists)
4. Developer fixes the bug
5. Test passes (proving the fix works)
6. Test is committed with the fix (in the same PR)
7. Test title includes issue reference: "should ... (#issue-number)"
```

### Documenting Historical Bugs

Create a `tests/e2e/data/regression-catalog.md` (future) to track:

| Issue | Date       | Test                              | Root Cause                     | Fix PR |
| ----- | ---------- | --------------------------------- | ------------------------------ | ------ |
| #1423 | 2026-05-20 | `onboarding/edge-cases.spec.ts`   | Missing duplicate email check  | #1456  |
| #1510 | 2026-05-22 | `resilience/sse-recovery.spec.ts` | SSE heartbeat not reconnecting | #1522  |

### Avoiding Reintroduction

- **Never delete a regression test** — unless the feature itself is removed
- **Tag regression tests** — add `@regression` tag (Playwright tag support) for selective execution
- **Run regression suite before release** — create a CI workflow that runs only tagged regression tests
- **Link to bug tracker** — every regression test title should include the issue number

### Risk-Based Testing

When deciding what to test, prioritize based on:

1. **Business impact** — How much revenue/user trust is at risk?
2. **Frequency of use** — How often do users interact with this flow?
3. **Complexity** — How many services/components are involved?
4. **Change frequency** — How often does this code change?
5. **Historical bugs** — Has this area been buggy before?

For BookWise, the highest-risk areas are:

- Borrow lifecycle (directly affects library operations)
- Authentication (security)
- Admin real-time dashboard (admin trust)
- Upload pipeline (data integrity)

---

## 13. Testing Checklist Before Every PR

### Before committing test changes, verify:

- [ ] Tests pass locally with `npx playwright test`
- [ ] Tests pass in CI (after push)
- [ ] No `.only` left in any test file
- [ ] No `waitForTimeout()` used for synchronization
- [ ] All test data uses unique identifiers (worker-indexed or random)
- [ ] `beforeAll`/`afterAll` properly seed and clean up data
- [ ] Cleanup wrapped in `.catch(() => {})` to avoid masking test failures
- [ ] No hardcoded URLs — use relative paths or `baseURL`
- [ ] Test title clearly describes the expected behavior
- [ ] Comments explain WHY (not what), if any
- [ ] No sensitive credentials or tokens hardcoded
- [ ] Mocked third-party services (ImageKit, EmailJS) are properly handled
- [ ] Test does not depend on other tests running first
- [ ] If serial mode is used, there is a clear reason (documented in comment)
- [ ] No browser-specific assumptions unless explicitly annotated
- [ ] Network diagnostics are asserted at the end of critical tests

### Before merging a PR with test changes:

- [ ] CI passes on the target branch
- [ ] Playwright report artifact is clean (no unexpected failures)
- [ ] No flaky tests in the run (check if retries were consumed)
- [ ] Code review confirms test design follows this guide
- [ ] If adding a new test file, it follows the naming conventions
- [ ] If adding a new fixture, it follows the inheritance pattern

---

## 14. Common E2E Anti-Patterns

### 1. Using `page.waitForTimeout()` for Synchronization

```typescript
// ANTI-PATTERN
await page.waitForTimeout(3000);
await expect(locator).toBeVisible();

// CORRECT
await expect(locator).toBeVisible({ timeout: 10_000 });
```

### 2. Depending on Test Execution Order

```typescript
// ANTI-PATTERN
let createdUserId: string;
test("create", async () => {
  createdUserId = "abc";
});
test("read", async () => {
  /* uses createdUserId */
}); // Fails alone

// CORRECT
test("full CRUD", async () => {
  /* self-contained */
});
```

### 3. Using Brittle CSS Selectors

```typescript
// ANTI-PATTERN
page.locator("#root > div > div:nth-child(3) > button");

// CORRECT
page.getByRole("button", { name: "Submit" });
```

### 4. Sharing Browser Context Between Roles

```typescript
// ANTI-PATTERN
const page = await browser.newPage();
// Both admin and user use the same page
await signIn(page, adminEmail);
await signIn(page, userEmail); // Session conflict!

// CORRECT
const adminCtx = await browser.newContext();
const userCtx = await browser.newContext();
```

### 5. Not Cleaning Up Test Data

```typescript
// ANTI-PATTERN
test("search", async () => {
  await seedBooks(); // Never cleaned up
});

// CORRECT
test.afterEach(async () => {
  await cleanupBooks().catch(() => {}); // Best-effort cleanup
});
```

### 6. Asserting Without Waiting

```typescript
// ANTI-PATTERN
await page.goto("/search");
const count = await page.locator(".result").count();
expect(count).toBe(8); // DOM may not be ready

// CORRECT
await expect(page.locator(".result")).toHaveCount(8); // Auto-waits
```

### 7. Over-mocking

```typescript
// ANTI-PATTERN — mocking everything makes tests pointless
await page.route("**/api/**", ...);
await page.route("**/*", ...); // Too broad

// CORRECT — only mock external dependencies
await page.route("**/api/auth/imagekit", ...);
await page.route("https://upload.imagekit.io/**", ...);
```

### 8. Skipping Error Assertions

```typescript
// ANTI-PATTERN — not checking for console errors
await doSomething();
// No assertion that the page didn't crash

// CORRECT — assert no critical errors
const errors = addNetworkListeners(page);
await doSomething();
expect(errors.filter(critical).length).toBe(0);
```

### 9. Hardcoded Environment-Specific Values

```typescript
// ANTI-PATTERN
await page.goto("http://localhost:3000/sign-in");
expect(page.url()).toBe("http://localhost:3000/admin");

// CORRECT
await page.goto("/sign-in");
expect(page.url()).toContain("/admin");
```

### 10. Ignoring the `exact` Option

```typescript
// ANTI-PATTERN — matches multiple elements
page.getByLabel("Email"); // Might match "Email" and "Confirm Email"

// CORRECT — exact match
page.getByLabel("Email", { exact: true });
```

---

## 15. Definition of a Good E2E Test

### A Good E2E Test Is:

1. **Independent** — Can run alone, in any order, in parallel with others. No shared mutable state.

2. **Deterministic** — Given the same initial state, it always produces the same result. Seeds its own data, cleans up after itself.

3. **Fast enough** — Completes within 120 seconds (current max timeout). Each `test.step()` has a clear, single purpose.

4. **Readable** — A developer unfamiliar with the codebase can read the test and understand what the feature does. `test.step()` descriptions form a human-readable narrative.

5. **Resilient** — Uses web-first assertions, `expect.poll()` for dynamic content, and mocked external services. Does not rely on arbitrary timers.

6. **Semantically locatored** — Uses `getByRole`, `getByLabel`, `getByText` over CSS selectors. Locators match what users see, not how the DOM is structured.

7. **Self-verifying** — Does not require manual inspection. Every expectation is explicit. Console errors and network failures are asserted.

8. **Minimal** — Tests one behavior per test name. Does not duplicate coverage that exists at lower test levels. Does not test what unit tests already cover.

9. **Documented** — Comments explain WHY (design decisions, workarounds, known issues), not WHAT (the code already says what it does).

10. **Safe** — Isolated from other tests via worker-indexed data. Third-party services are mocked. No production data is touched.

### A Good E2E Test Looks Like:

```typescript
test("complete borrowing lifecycle: borrow → approve → receipt → return", async ({
  userPage,
  adminPage,
}) => {
  // Arrange — seed data (independent, deterministic)
  await ensureUserExists();
  await ensureAdminExists();
  const book = await seedTestBook();

  // Act & Assert — structured steps (readable, self-verifying)
  await test.step("User signs in and views book detail", async () => {
    await signIn(userPage, TEST_USER.email, TEST_USER.password);
    await userPage.goto(`/books/${book.id}`);
    await expect(
      userPage.getByRole("heading", { name: book.title }),
    ).toBeVisible();
  });

  await test.step("User clicks borrow request", async () => {
    await userPage.getByRole("button", { name: "Borrow Book Request" }).click();
    await expect(userPage.getByText("Book request is forwarded")).toBeVisible();
  });

  // ... more steps ...

  // Verify clean state (resilient, self-verifying)
  await test.step("No critical errors", async () => {
    expect(criticalErrors).toHaveLength(0);
  });

  // Clean up (minimal, safe)
  await cleanupTestBook().catch(() => {});
});
```

### Characteristics of a Test That Needs Refactoring

- **Flaky** — Fails intermittently in CI. Root cause is often timing, race conditions, or data collisions.
- **Slow** — Takes longer than 120 seconds. Usually doing too much or not isolating data properly.
- **Brittle** — Breaks on unrelated CSS changes. Uses class-name selectors or structural selectors.
- **Hard to debug** — Fails with no helpful output. Missing screenshots, no console error assertions.
- **Duplicated** — Same setup/logic copied across multiple files. Extract to fixtures or helpers.
- **Overly coupled** — Tests too many things at once. Hard to tell what behavior is being verified.

---

_This document is maintained by the BookWise Engineering Team. Updates should be proposed via PR to `documentation/TESTING.md`._
