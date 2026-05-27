# Unit & Integration Testing Guide

> **Audience:** Developers writing or maintaining Vitest tests for BookWise.
> **E2E testing** is documented separately in [`TESTING.md`](./TESTING.md).

---

## 1. Overview

BookWise uses **Vitest** for both unit and integration tests, split into two
independent configurations:

| Layer | Config File | Test Root | Setup | Script |
|-------|-------------|-----------|-------|--------|
| **Unit** | `vitest.config.ts` | `tests/unit/` | `tests/unit/setup.ts` | `npm run test` |
| **Integration** | `vitest.config.integration.ts` | `tests/integration/` | `tests/integration/setup.ts` | `npm run test:integration` |

Both environments use `jsdom`, `globals: true`, and the `@` path alias.

---

## 2. Test Pyramid Strategy

```
         ╱╲
        ╱ E2E ╲           (Playwright — documented in TESTING.md)
       ╱────────╲
      ╱ Integration ╲     (Vitest — mock external I/O only)
     ╱──────────────╲
    ╱    Unit Tests    ╲  (Vitest — pure logic, minimal mocking)
   ╱────────────────────╲
  ╱    Static Analysis    ╲ (TypeScript, ESLint)
 ╱──────────────────────────╲
```

**Unit tests** validate pure business logic in isolation — Zod schemas, status
machines, date calculations, type guards, SSE encoding. Mocking is minimal
or absent.

**Integration tests** load real route handlers and server actions but mock
*external* dependencies: Redis, NextAuth, broadcast/pub-sub, workflow triggers.
Business logic, Drizzle query chains, version checks, authorization guards,
and locking assertions are **not** mocked — they run against an in-memory
database mock (`InMemoryDb`) that simulates Drizzle ORM semantics.

---

## 3. Project Structure

```
tests/
├── unit/
│   ├── setup.ts                        # afterEach: restoreAllMocks, useRealTimers
│   ├── validations.test.ts             # signUpSchema, signInSchema, bookSchema
│   ├── borrowStatusMachine.test.ts     # validateBorrowStatusTransition, deltas
│   ├── returnPolicy.test.ts            # calculateBorrowStatus, colors, labels
│   ├── rateLimit.test.ts               # getClientIp, headers, safeRateLimit
│   ├── sseHeaderParsing.test.ts        # Last-Event-ID parsing
│   ├── systemConfig.test.ts            # formatBorrowDuration, due dates
│   ├── imageCrop.test.ts               # canvas-based avatar cropping
│   ├── borrowBookRealtimeEvents.test.ts# message factories, type guards, SSE
│   ├── dashboardRealtimeEvents.test.ts # message factories, type guards, SSE
│   └── bookSimilar.test.ts             # getSimilarBooks cache wrapper
│
├── integration/
│   ├── setup.ts                        # vi.mock factories for all externals
│   ├── auth.test.ts                    # signInWithCredentials, signUp
│   ├── admin-actions.test.ts           # approve/reject/delete user, role update
│   ├── book-crud.test.ts               # CRUD + pagination/search
│   ├── borrow-request.test.ts          # POST /api/book/requests
│   ├── borrow-transitions.test.ts      # approve/reject/return PATCH endpoints
│   ├── receipt-generation.test.ts      # generate/get receipt
│   ├── realtime.test.ts                # SSE event side effects
│   ├── sse-endpoints.test.ts           # 3 SSE streaming routes
│   ├── concurrency.test.ts             # Race conditions (borrow/approve)
│   ├── concurrency-extended.test.ts    # Delete/role/book-update races
│   ├── redis-locking.test.ts           # Distributed lock module
│   ├── session-jwt.test.ts             # NextAuth JWT/session callbacks
│   ├── cron-expire-reservations.test.ts# Reservation expiry cron
│   ├── connection-leasing-replay.test.ts# SSE leases + replay buffer
│   ├── avatar-upload.test.ts           # Avatar upload/update endpoints
│   └── helpers/
│       ├── instances.ts                # Shared vi.fn() instances (48 lines)
│       ├── fixtures.ts                 # Test data factories (317 lines)
│       ├── assertions.ts               # DB-state assertion helpers (83 lines)
│       ├── db-mock.ts                  # InMemoryDb (1248 lines)
│       └── test-env.ts                 # Legacy shared env (pre-assertions)
│
├── e2e/                                # Playwright (see TESTING.md)
└── ...
```

---

## 4. Configuration

### `vitest.config.ts` (unit)

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["node_modules", "tests/e2e"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

### `vitest.config.integration.ts`

Identical structure, but `setupFiles` points to `tests/integration/setup.ts`
and `include` is `tests/integration/**/*.test.ts`.

### Unit setup (`tests/unit/setup.ts`)

```ts
import { vi, afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
```

Every unit test gets a clean mock slate and real timers after each test.

---

## 5. Naming Conventions

| Artifact | Convention | Example |
|----------|-----------|---------|
| Test file | `<moduleName>.test.ts` | `auth.test.ts`, `borrow-request.test.ts` |
| Top-level describe | `describe("module/path")` | `describe("signInWithCredentials")` |
| Secondary describe | `describe("scenario")` | `describe("happy path")` |
| Test case | `it("action + expected result")` | `it("returns 401 when user is not authenticated")` |
| Test data factory | `create<Entity>` | `createApprovedUser`, `createAvailableBook` |
| Assertion helper | `assert<Expectation>` | `assertBorrowStatus`, `assertBookCounts` |
| Mock instance | `mock<Dependency>` | `mockAuth`, `mockRedisGet`, `mockBroadcastAdminDashboard` |
| Module variable | `let <Handler/Func>` | `let POST: PostHandler`, `let approveAccount` |

---

## 6. Patterns & Structure

### Unit tests

Pure function testing. No `vi.mock` in most files (exceptions like
`borrowStatusMachine.test.ts` and `bookSimilar.test.ts` mock server-only
modules to avoid import errors). Use `vi.useFakeTimers` for date-dependent
logic (return policy, system config).

```ts
describe("calculateBorrowStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
  });

  it("returns isOverdue=false when due date is in the future", () => {
    const result = calculateBorrowStatus("2026-05-20", "2026-06-03");
    expect(result.isOverdue).toBe(false);
    expect(result.daysLeft).toBeGreaterThan(0);
  });
});
```

### Integration tests — common template

```ts
describe("POST /api/book/requests", () => {
  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);
      const response = await POST(createRequest("any-book-id"));
      expect(response.status).toBe(401);
    });
  });

  describe("capacity", () => {
    it("returns 409 when no copies available", async () => {
      mockDb.seed("books", [createFullyBorrowedBook({ id: "book-1" })]);
      const response = await POST(createRequest("book-1"));
      expect(response.status).toBe(409);
    });
  });
});
```

Every integration test file follows this structure:

1. **Imports** — mock instances, fixtures, assertion helpers
2. **Module variable declarations** — `let POST: PostHandler`
3. **`beforeEach`** — reset mock DB, seed defaults, configure auth/locks, lazy-import
4. **`describe` blocks** — one per action/endpoint, subdivided by scenario
5. **Assertions** — mixture of `expect(response.status)` and custom helpers

---

## 7. Mock Architecture

### The "instance sharing" pattern

```
instances.ts (created once)
    │
    ├── vi.mock factories in setup.ts
    │     (import instances via dynamic import)
    │
    └── Individual test files
          (import instances directly)
```

**`tests/integration/helpers/instances.ts`** creates all mock function instances at
module-load time. Both `setup.ts` (for `vi.mock` factories) and test files (for
configuring return values / asserting calls) import from this single source.

Because Vitest hoists `vi.mock` calls to the top of the file, the factories in
`setup.ts` use **dynamic `await import()`** to reference the shared instances:

```ts
// setup.ts
vi.mock("@/auth", async () => {
  const { mockAuth, mockSignIn, mockSignOut } =
    await import("./helpers/instances");
  return { auth: mockAuth, signIn: mockSignIn, signOut: mockSignOut };
});

vi.mock("@/database/drizzle", async () => {
  const { mockDb } = await import("./helpers/instances");
  return { db: mockDb };
});
```

### What is mocked

| Module | Mocked By | Notes |
|--------|-----------|-------|
| `@/auth` (next-auth) | `mockAuth`, `mockSignIn`, `mockSignOut` | Returns session object or null |
| `next/headers` | `mockHeaders` | Returns mocked `Headers` with IP |
| `next/cache` | `mockRevalidatePath`, `mockRevalidateTag` | Spy on cache invalidation |
| `next/navigation` | `mockRedirect` | Spy on redirect calls |
| `@/database/redis` | `mockRedisGet`, `mockRedisSet`, etc. | 7 mock functions |
| `@/database/drizzle` | `mockDb` (`InMemoryDb` instance) | Full query-engine mock |
| `broadcast/dashboardSocketServer` | `mockBroadcastAdminDashboard`, `mockBroadcastBookAvailability` | Fire-and-forget |
| `concurrency/rowConcurrency` | `mockPublishEvent` (other exports kept real) | Partial mock via `vi.importActual` |
| `session/roleChangePublisher` | `mockPublishRoleChangeEvent` | |
| `@/lib/workflow` | `mockWorkflowTrigger` | |
| `@/lib/config` | Static mock | Environment variables |
| `@/lib/essentials/rateLimit` | `safeRateLimit` replaced | Always returns success by default |
| `server-only` | Empty mock | Prevents "module not found" |

### What is NOT mocked

- Business logic (status transitions, availability computation)
- Drizzle query chain (runs against `InMemoryDb`)
- Version-based optimistic concurrency checks
- Authorization guards (admin role checks, user status checks)
- Lock assertion logic (token matching, ownership validation)
- Transaction boundaries (`db.transaction`)

### Rate limit control

By default, `safeRateLimit` always returns `{ success: true, limit: MAX_SAFE_INTEGER, ... }`,
so rate limiting never interferes. Tests that need rate-limit-blocked behaviour
can override via `vi.mocked(safeRateLimit).mockResolvedValueOnce(...)`.

For broader control, `instances.ts` exports:

```ts
bypassRateLimit(bypass = true);     // disable/enable the bypass
isRateLimitBypassed();              // query current state
```

---

## 8. InMemoryDb (`db-mock.ts`)

A **1248-line** in-memory database that mimics Drizzle ORM query chains.
It is *not* a simple `Map` — it implements real SQL-level semantics:

### Query chain methods

| Method | Behaviour |
|--------|-----------|
| `.select()` | Starts a SELECT query |
| `.from(table)` | Sets target table |
| `.leftJoin(table, on)` | Simulates join (filter merge) |
| `.where(condition)` | Parses Drizzle SQL → filter predicates |
| `.groupBy(...)` | Tracks group-by columns |
| `.orderBy(col, dir)` | Post-filter sorting |
| `.limit(n)` | Pagination |
| `.offset(n)` | Pagination |
| `.forUpdate()` | Marks row-level lock intent |
| `.execute()` / `then()` | Runs the query, returns rows |
| `.insert(table)` | Starts INSERT |
| `.values(rows)` | Seeds data (with defaults) |
| `.set(data)` | UPDATE SET clause |
| `.delete(table)` | Starts DELETE |
| `.returning()` | Returns affected rows |
| `.begin()` / `.commit()` / `.rollback()` | Transaction stubs |
| `.transaction(fn)` | Wraps callback in try/catch |
| `.refreshTable(table)` | Re-reads table data |

### Condition evaluation

Drizzle conditions are passed as SQL-like objects with `getSQL()`.
`InMemoryDb` walks the `queryChunks` tree via `extractSqlFromCondition`,
reconstructs SQL + params, then parses predicate patterns:

- `"t"."col" = $N` / `!= $N`
- `"t"."col" IN (list)` / `IN ($N)`
- `"t"."col" ILIKE $N` (translates to RegExp)
- `AND` / `OR` combinations
- Nested `NOT` conditions
- `EXISTS (subquery)`
- Composite primary keys

### Optimistic concurrency

Each row has a `version` field. When the mock processes an update, it checks:

1. The row exists and its version matches the condition
2. If matched, increments `version` atomically
3. Returns the number of affected rows

This mirrors Drizzle's `update(...).set(...).where(eq(table.version, oldVersion))`.

### Row locking (FOR UPDATE)

When `.forUpdate()` is called and a transaction is active, the mock records
a lock on the row. Subsequent reads in other "transactions" see the locked
row until commit/rollback.

### Advisory lock simulation

`tryLock(entity, entityId, adminId, token, ttl)` and `releaseLock(...)` mimic
Redis-based distributed locking at the DB level, used by the concurrency tests.

### Public API (used by tests)

```ts
mockDb.clear();                               // Reset all tables
mockDb.setDefaults("table", { field: val });  // Default column values
mockDb.seed("table", [row1, row2]);           // Pre-populate data
mockDb.getQueryLog();                         // Assert on query patterns
mockDb.getRow("table", id);                   // Direct row access
```

---

## 9. Test Data Fixtures & Assertions

### Fixtures (`fixtures.ts`)

Factory functions produce complete, deterministic rows with sensible defaults.
Every factory accepts an `overrides` object to customise specific fields.

```ts
// User factories
createUser(overrides?)          // Generic
createPendingUser(overrides?)   // status: "PENDING"
createApprovedUser(overrides?)  // status: "APPROVED"
createRejectedUser(overrides?)  // status: "REJECTED"
createAdmin(overrides?)         // status: "APPROVED", role: "ADMIN"

// Book factories
createBook(overrides?)
createAvailableBook(overrides?)         // totalCopies=5, borrowed=0, reserved=0
createFullyBorrowedBook(overrides?)     // totalCopies=3, borrowed=3, reserved=0
createFullyReservedBook(overrides?)     // totalCopies=2, borrowed=0, reserved=2

// Borrow record factories
createBorrowRecord(overrides?)
createPendingBorrow(overrides?)
createBorrowedBorrow(overrides?)
createReturnedBorrow(overrides?)
createLateReturnBorrow(overrides?)     // dueDate in the past
createRejectedBorrow(overrides?)

// Session factories
createAdminSession(adminId?)
createUserSession(userId?)
createUnauthenticatedSession()          // null

// Rate limit factories
createRateLimitPass()
createRateLimitBlock()

// Lock factory
createLockPayload(overrides?)

// Request helpers
createMockRequest(body, options?)
createMockAdminRequest(body, params, options?)

// Utility
resetCounters()       // Reset sequence counters between tests
hashPassword(pwd)     // Real bcrypt hash
DUMMY_HASH            // Pre-computed bcrypt hash of "dummy"
```

### Assertions (`assertions.ts`)

Domain-specific DB-state assertions that make tests read as specifications:

```ts
assertRowExists(tableName, id)              // Returns the row
assertRowNotExists(tableName, id)
assertVersionIncremented(tableName, id, oldVersion)
assertVersionUnchanged(tableName, id, expectedVersion)
assertBorrowStatus(recordId, expectedStatus)
assertBookCounts(bookId, { borrowedCount, reservedCount, availableCopies })
assertUserStatus(userId, expectedStatus)
assertUserRole(userId, expectedRole)
assertQueryLogContains(type, table?)
assertQueryLogCount(expected)
```

---

## 10. Unit Test Deep Dives

### `validations.test.ts` (272 lines)

Tests three Zod schemas (`signUpSchema`, `signInSchema`, `bookSchema`) with
boundary-value analysis — min/max lengths, type coercion, whitespace trimming,
missing fields via `it.each`, unknown field stripping, and edge cases like
XSS payloads and unicode characters.

**Pattern:** `schema.safeParse(payload).success` checks with no mocking.

### `borrowStatusMachine.test.ts` (185 lines)

Tests the `validateBorrowStatusTransition` function and delta computation logic.
Uses exhaustive 5×5 matrix coverage (all 25 transitions) to confirm exactly 4
are allowed. Also tests delta arithmetic for reservat ion/borrow count changes.

**Pattern:** `vi.mock` for server-only modules, then dynamic `await import`
of the module under test.

### `returnPolicy.test.ts` (224 lines)

Tests `calculateBorrowStatus`, `getBorrowStatusColor`, `getBorrowStatusText`
with `vi.useFakeTimers` for deterministic dates. Covers DST transitions, leap
year, same-day borrow/due, far future, and edge-of-midnight overdue detection.

### `rateLimit.test.ts` (324 lines)

Tests IP extraction (`x-forwarded-for`, `x-real-ip`, IPv6, fallback),
rate-limit identity resolution, HTTP header formatting ("Retry-After",
"X-RateLimit-*"), `safeRateLimit` with `SKIP_RATE_LIMIT` env, error fallback,
and SSE connection limit constants.

### `sseHeaderParsing.test.ts` (55 lines)

Tests SSE `Last-Event-ID` header parsing — parseInt edge cases (hex, octal,
NaN, Infinity, whitespace, leading zeros, MAX_SAFE_INTEGER). Pure function,
no mocking.

### `systemConfig.test.ts` (111 lines)

Tests `formatBorrowDuration` (pluralization, negatives, non-integers) and
`getDueDateFromBorrowDuration` (dayjs arithmetic, month boundaries, leap year,
immutability). Uses `vi.useFakeTimers`.

### `imageCrop.test.ts` (256 lines)

Tests client-side image cropping (`getCroppedImg`, `createImage`). Mocks
`Image` constructor, `canvas.toBlob`, and `URL.createObjectURL`. Covers:
successful crop, null canvas context, tainted canvas rejection, zero-dimension
crop, crop larger than source, negative coordinates.

### `borrowBookRealtimeEvents.test.ts` (334 lines)

Tests message factories, type guards, SSE encoding, and module constants for
the book-borrow realtime event subsystem. Full type-guard null/undefined/type
rejection coverage.

### `dashboardRealtimeEvents.test.ts` (181 lines)

Same pattern for admin dashboard SSE events. Tests `createDashboardConnectedMessage`,
`createDashboardRefreshMessage`, `isDashboardRealtimeMessage`, `encodeDashboardSseEvent`,
and all module constants.

### `bookSimilar.test.ts` (98 lines)

Tests the `getSimilarBooks` server action which wraps a cached function. Covers:
success with results, empty results, undefined-field serialisation, Error
rejection, and non-Error rejection. Uses `vi.mock` for the cache layer.

---

## 11. Integration Test Deep Dives

### `auth.test.ts` (513 lines)

Tests `signInWithCredentials` and `signUp` server actions.

**`signInWithCredentials`** — valid/invalid passwords, PENDING user success,
rate-limit bypass, missing user, wrong password, blocked user, multiple
consecutive sign-in, email case sensitivity, unicode passwords, edge-case
role/status combos.

**`signUp`** — duplicate email/universityId, password hashing, default role,
PENDING status after sign-up, rate-limit override, admin dashboard broadcast,
workflow trigger for re-engagement email, extraneous fields stripped, whitespace
trimming, case-insensitive duplicate detection.

### `admin-actions.test.ts` (735 lines)

Tests `approveAccount`, `rejectAccount`, `deleteUser`, `updateUserRole`.

**`approveAccount`** — version-locked approval, double-approve idempotency,
lock ownership enforcement, reentrant approval by lock owner, missing lock,
reject → approve transition, PENDING-only guard, realtime broadcasts.

**`rejectAccount`** — similar structure with status-lock checks.

**`deleteUser`** — active-borrow guard, no-borrow success, non-existent user,
version conflict, transactional delete (user + borrow records), best-effort
lock release.

**`updateUserRole`** — USER→ADMIN and ADMIN→USER transitions, admin-remain
guard (last admin can't be demoted), sessionVersion bump on downgrade,
role-change event publishing.

### `book-crud.test.ts` (1027 lines)

Tests `createBook`, `updateBook`, `deleteBook`, `getBookById`, `getAllBooks`.

**`createBook`** — successful creation, duplicate guard, cache revalidation,
realtime event, realtime fallback on error.

**`updateBook`** — version-locked update, lock ownership, totalCopies guard
(can't reduce below borrowed count), TOCTOU race window (borrow completes
between count check and update), concurrent update rejection, broadcast
(various failure modes).

**`deleteBook`** — borrow-record guard (active borrows block deletion),
version check, no-borrow-books success, lock lifecycle.

**`getAllBooks`** — pagination, genre filtering, search query (ILIKE on
title/author/genre), empty results, case-insensitive search, missing coverUrl
handling, negative page handling.

### `borrow-request.test.ts` (836 lines)

Tests `POST /api/book/requests` — the primary borrow creation endpoint.

Covers authentication (401, 403 for non-admin), no-user-id session, capacity
checks (fully borrowed, fully reserved, partial availability), duplicate
prevention (same user + same book + PENDING), successful creation (201),
counter consistency, stale PENDING expiry during transaction, multiple books
same user, missing bookId, non-existent book, rate-limit bypass, realtime
broadcasts (dashboard + book availability + publishEvent), cache revalidation,
advisory lock invocation, multiple concurrent requests for different books.

### `borrow-transitions.test.ts` (941 lines)

Tests `PATCH approve`, `PATCH reject`, `PATCH return` endpoints.

**approve** — PENDING→BORROWED transition, counter deltas, due date computation,
double-approve rejection, version conflict, lock ownership, already-approved
block, broadcast.

**reject** — PENDING→REJECTED, counter correction, reject-after-approve blocked.

**return** — BORROWED→RETURNED vs BORROWED→LATE_RETURN distinction (based on
due date), already-returned blocked, return-with-override.

### `receipt-generation.test.ts` (409 lines)

Tests `generateReceipt` and `getReceipt` server actions.

Auth enforcement (admin only), PENDING→BORROWED with dueDate computation,
already-RETURNED/LATE_RETURN blocked, record-not-found, realtime events,
dashboard broadcast, receipt data shape, cross-table consistency.

### `realtime.test.ts` (604 lines)

Focuses on **event side effects** rather than business logic. Validates that
realtime events are published at the correct lifecycle points, are NOT allowed
to rollback the primary DB transaction, are fire-and-forget where designed,
and carry correct channel/type/entityId.

Spans POST borrow, PATCH approve, PATCH return, and server actions
(approveAccount, deleteUser, updateUserRole).

### `sse-endpoints.test.ts` (776 lines)

Tests three SSE routes: `/api/book/stream`, `/api/admin/dashboard/realtime`,
`/api/admin/realtime/rows`.

Covers auth enforcement per endpoint, rate-limit integration (safeRateLimit +
connection leases), Last-Event-ID parsing and replay binding, stream
initialisation (retry frame, heartbeat, connected events), cleanup on abort
(lease release, subscription unsubscribe), Redis pub/sub lifecycle, heartbeat
encoding, connection lease lifecycle, graceful degradation on Redis failure.

SSE tests use `AbortController` to simulate client disconnect.

### `concurrency.test.ts` (463 lines)

Race-condition tests despite single-threaded Vitest. Validates that business
logic uses advisory locks, version checks, and conditional updates correctly.

Scenarios: two simultaneous borrows for last available copy, two simultaneous
approves on same request, version conflict from stale read, capacity exhaustion
race, concurrent borrows for different books, same-user-same-book duplicate
prevention.

### `concurrency-extended.test.ts` (1011 lines)

Targets race windows NOT covered by core concurrency suite:

- Two admins deleting same user simultaneously
- Active-borrow guard race (borrow created between guard check and delete)
- `FOR UPDATE` lock contention on user row
- Two admins role-updating same user simultaneously
- Last-admin guard + concurrent delete of other admin
- sessionVersion bump correctness under concurrent downgrade attempts
- Borrow transaction completes between count query and updateWithVersionCheck
- Lock ownership prevents concurrent modification
- Lock release on success/failure paths

### `redis-locking.test.ts` (562 lines)

Tests the `rowConcurrency.ts` module directly. Validates Lua script invocation
patterns (KEYS + ARGV), lock state transitions, re-entrant acquisition,
ownership enforcement, heartbeat renewal, expiration, token mismatch rejection,
corrupt lock recovery, event publishing, concurrent contention, and graceful
degradation on Redis errors.

### `session-jwt.test.ts` (372 lines)

Tests NextAuth `jwt` and `session` callbacks programmatically. Maps user→token→
session pipeline for id, role, sessionVersion, image. Tests: trigger="update"
image refresh, role propagation, sessionVersion consistency, user data mapping
at sign-in.

### `cron-expire-reservations.test.ts` (749 lines)

Tests `GET /api/book/cron/expire-reservations`. CRON_SECRET authorization, no-op
when no stale records, expiration of old PENDING records, exact time-boundary
behaviour (fresh vs stale), idempotency (double-run same result), multiple
books affected, counter consistency (reservedCount decremented), concurrent
PENDING modification during cron execution, broadcast fan-out, graceful
degradation on broadcast failure.

### `connection-leasing-replay.test.ts` (453 lines)

Tests two subsystems from `rateLimit.ts` and `dashboardRedisPubSub.ts`:

**Connection leasing** — lease acquisition with user/IP identity, connection
limit enforcement (authenticated=3, anonymous=2), lease refresh, lease release,
expired lease cleanup, graceful degradation.

**Replay buffer** — replay ordering by event ID, Last-Event-ID filtering,
buffer content integrity, empty replay, corrupt entry filtering,
publishBookAvailabilityUpdate Lua script pattern.

### `avatar-upload.test.ts` (390 lines)

Tests `PUT /api/avatar/upload` and `POST /api/avatar/update`. Auth enforcement,
rate limiting (upload=10/day, update=5/day via safeRateLimit), image input
validation, old avatar cleanup via ImageKit deleteFile, SSE propagation, cache
revalidation, graceful degradation, DB state consistency.

---

## 12. Running Tests

```bash
# Unit tests (vitest.config.ts)
npm run test                      # Single run
npm run test:watch                # Watch mode

# Integration tests (vitest.config.integration.ts)
npm run test:integration           # Single run
npm run test:integration:watch     # Watch mode

# All tests
npm run test && npm run test:integration

# With specific file filter
npx vitest run --config vitest.config.integration.ts tests/integration/auth.test.ts

# Coverage (requires @vitest/coverage-v8)
npx vitest run --coverage
```

---

## 13. Debugging & Troubleshooting

### Common issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `vi.mock` not hoisted | Factory uses variable from outer scope | Use inline `await import()` |
| Mock not reset between tests | Missing `beforeEach` reset | Call `mockFn.mockClear()` / `mockDb.clear()` |
| "Module not found: server-only" | File imports server-only without mock | Add `vi.mock("server-only", () => ({}))` |
| Rate limiting blocks everything | `safeRateLimit` returns `success: false` | Mock return value or verify `bypassRateLimit(true)` |
| Timers not advancing | Date-dependent test without fake timers | Add `vi.useFakeTimers()` in `beforeEach` |
| Lock assertion fails | Redis mock not configured | Set `mockRedisGet` + `mockRedisEval` in `beforeEach` |

### Debugging tips

- Run a single file with `--reporter=verbose` to see individual test names
- Use `npx vitest --config vitest.config.integration.ts --test-timeout=30000` for
  slow tests (SSE streams with timers)
- Log mock DB state with `console.log(mockDb.debug())` in tests
- Trace query execution with `mockDb.getQueryLog()`
- Check mock invocations with `expect(mockRedisEval).toHaveBeenCalledWith(...)`

### SSE endpoint debugging

SSE tests use `AbortController` to disconnect. The response body is a
`ReadableStream` — test code reads chunks, asserts on SSE frames, then aborts.
If a test hangs, it likely means the stream wasn't aborted in a `finally` block.

```ts
const controller = new AbortController();
const response = await GET(request, controller.signal);
// ... read stream ...
controller.abort();
```

---

## 14. CI/CD Integration

```yaml
# .github/workflows/test.yml (recommended)
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test
        env:
          SKIP_RATE_LIMIT: "true"

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:integration
        env:
          SKIP_RATE_LIMIT: "true"
          CRON_SECRET: "test-secret"
```

Integration tests do not require a real database, Redis server, or any
external process — they run fully in-memory.

---

## Appendix A — Quick Reference

| Task | Command |
|------|---------|
| Run unit tests | `npm run test` |
| Run unit tests (watch) | `npm run test:watch` |
| Run integration tests | `npm run test:integration` |
| Run integration tests (watch) | `npm run test:integration:watch` |
| Run single file | `npx vitest run path/to/file.test.ts` |
| Run with coverage | `npx vitest run --coverage` |
| Run with different config | `npx vitest run --config vitest.config.integration.ts` |
| Debug with UI | `npx vitest --ui` |

### Key files at a glance

| File | Role |
|------|------|
| `vitest.config.ts` | Unit test config |
| `vitest.config.integration.ts` | Integration test config |
| `tests/unit/setup.ts` | Unit afterEach cleanup |
| `tests/integration/setup.ts` | Integration vi.mock factories |
| `tests/integration/helpers/instances.ts` | Shared mock functions |
| `tests/integration/helpers/db-mock.ts` | In-memory Drizzle mock (1248 lines) |
| `tests/integration/helpers/fixtures.ts` | Test data factories (317 lines) |
| `tests/integration/helpers/assertions.ts` | DB-state assertions (83 lines) |

---

## Appendix B — Coverage Goals

The `@vitest/coverage-v8` package is available as a devDependency. While
no hard thresholds are configured in `vitest.config.*` today, the following
areas are high-priority for coverage:

- **Unit:** 100% branch coverage for Zod schemas, status machine, return policy,
  rate limit parsing, SSE encoding
- **Integration:** Every route handler and server action exercised through at
  least one happy path and one failure path
- **Concurrency:** All documented race windows covered
- **Realtime:** Every event type published in at least one test

---

## Appendix C — Definition of Done (Testing Criteria)

A feature is considered fully tested when:

1. **Unit tests** cover all pure-logic branches (validation, state machines,
   date calculations, type guards)
2. **Integration tests** cover:
   - Happy path (200/201 success)
   - Authentication enforcement (401 unauthenticated)
   - Authorization enforcement (403 non-admin)
   - Input validation failure (400/422)
   - Resource conflict (409)
   - Not-found (404)
   - Version conflict / optimistic locking
   - Rate limit blocking (where applicable)
   - Realtime event publishing (broadcasts, pub/sub events)
   - Cache revalidation (revalidatePath / revalidateTag)
3. **Concurrency tests** cover at least one race window per mutation
4. **All tests pass** with `npm run test && npm run test:integration`
5. **No flaky tests** — each test is deterministic, uses controlled timers
   and seeded data, and does not depend on wall-clock timing
