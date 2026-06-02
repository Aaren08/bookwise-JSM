# Database

## Overview

BookWise uses PostgreSQL with Drizzle ORM. The schema uses a counter-based inventory model with a generated `available_copies` column, optimistic concurrency via per-row `version` columns, and a singleton `app_settings` table that drives system configuration.

## Technology Stack

- **Database:** PostgreSQL (Neon Serverless)
- **ORM:** Drizzle ORM
- **Driver:** `postgres` (node-postgres) via `drizzle-orm/postgres-js`
- **Migrations:** Drizzle Kit

## Connection Setup

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/database/schema";
import config from "@/lib/config";

const globalForDb = globalThis as unknown as {
  postgresClient?: postgres.Sql;
};

const databaseUrl = config.env.databaseUrl;

export const sqlClient =
  globalForDb.postgresClient ??
  postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: Number(process.env.POSTGRES_MAX_CONNECTIONS ?? 5),
    onnotice: (notice) => {
      if (process.env.NODE_ENV !== "production") {
        console.info("[postgres notice]", notice.message);
      }
    },
    prepare: false,
    ssl: "require",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.postgresClient = sqlClient;
}

export const db = drizzle(sqlClient, { schema });
```

### Driver Notes

- Uses the **`postgres`** npm package (not `@neondatabase/serverless`). The connection pool is configured with `prepare: false` (required for Neon's PgBouncer-compatible pooled URLs) and `ssl: "require"`.
- `db.transaction()` **is supported** — all borrow-status mutation routes use real PostgreSQL transactions with `SELECT ... FOR UPDATE` row locking and `pg_advisory_xact_lock` for per-user/per-book concurrency. See [Query Patterns](#query-patterns).
- In production, the Neon pooled connection URL (containing `-pooler.`) is expected. A warning is emitted if the URL doesn't match this pattern.
- Connection pooling is limited to 5 connections by default (configurable via `POSTGRES_MAX_CONNECTIONS`).
- Redis (Upstash) is used separately for row-locking and realtime pub/sub, not as a database driver. See `database/redis.ts`.

---

## Enums

```typescript
export const STATUS_ENUM = pgEnum("status", [
  "PENDING", "APPROVED", "REJECTED",
]);

export const ROLE_ENUM = pgEnum("role", ["USER", "ADMIN"]);

export const BORROW_STATUS_ENUM = pgEnum("borrow_status", [
  "PENDING", "BORROWED", "RETURNED", "LATE_RETURN", "REJECTED",
]);

export const SETUP_EVENT_TYPE_ENUM = pgEnum("setup_event_type", [
  "SETUP_STARTED", "OWNER_CREATED", "SETTINGS_SAVED",
  "SETUP_COMPLETED", "SETUP_BLOCKED_ALREADY_INITIALIZED",
]);

export const ADMIN_AUDIT_ACTION_ENUM = pgEnum("admin_audit_action", [
  "ADMIN_CREATED", "ADMIN_UPDATED", "ADMIN_DEMOTED",
  "ADMIN_DELETED", "USER_STATUS_CHANGED", "SETTINGS_UPDATED",
]);

export const AUDIT_SOURCE_ENUM = pgEnum("audit_source", [
  "SETUP", "ADMIN_PANEL", "API", "SYSTEM", "MIGRATION",
]);
```

---

## Tables

### `users`

```typescript
export const users = pgTable("users", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  status: STATUS_ENUM("status").default("PENDING").notNull(),
  role: ROLE_ENUM("role").default("USER").notNull(),
  universityId: varchar("university_id", { length: 30 }),
  universityCard: text("university_card"),
  userAvatar: text("user_avatar"),
  userAvatarFileId: text("user_avatar_file_id"),
  sessionVersion: integer("session_version").notNull().default(1),
  lastActivityDate: date("last_activity_date").defaultNow(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("users_role_idx").on(table.role),
  index("users_status_idx").on(table.status),
  index("users_created_at_idx").on(table.createdAt),
  uniqueIndex("users_university_id_idx")
    .on(table.universityId)
    .where(sql`${table.universityId} IS NOT NULL`),
]);
```

**Notable fields:**

- `userAvatar` / `userAvatarFileId` — CDN URL and ImageKit file ID for the stored profile image.
- `universityId` / `universityCard` — **nullable**. `universityId` has a partial unique index (only non-null values).
- `status` / `role` — both have `.notNull()` with defaults.
- `updatedAt` — present on all mutable tables for change tracking.
- `version` — optimistic concurrency counter. Incremented by `updateWithVersionCheck()` on every write. Admin actions (approve, reject, delete, role change) pass `expectedVersion` and fail with a conflict error if the row has been modified since it was loaded.
- `sessionVersion` — incremented when a user is **downgraded from `ADMIN` to `USER`**. Embedded in the JWT at sign-in and compared against Redis pub/sub events to detect stale admin sessions. See [Admin Session Invalidation](Admin_Session_Invalidation.md).

---

### `books`

```typescript
export const books = pgTable("books", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  author: varchar("author", { length: 255 }).notNull(),
  genre: varchar("genre", { length: 255 }).notNull(),
  rating: real("rating").notNull().default(0),
  totalCopies: integer("total_copies").notNull().default(1),
  borrowedCount: integer("borrowed_count").notNull().default(0),
  reservedCount: integer("reserved_count").notNull().default(0),
  availableCopies: integer("available_copies")
    .generatedAlwaysAs(sql`total_copies - borrowed_count - reserved_count`)
    .notNull(),
  description: text("description").notNull(),
  coverColor: varchar("cover_color", { length: 7 }).notNull(),
  coverUrl: text("cover_url").notNull(),
  videoUrl: text("video_url").notNull(),
  summary: text("summary").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("available_copies_idx").on(table.availableCopies),
]);
```

**Inventory semantics:**

- `borrowedCount` — active approved loans. Incremented on approval, decremented on return.
- `reservedCount` — pending requests holding a copy. Incremented when a user submits a borrow request, decremented when that request is approved, rejected, or expires.
- `availableCopies` — **generated stored column**, computed by PostgreSQL as `total_copies - borrowed_count - reserved_count`. Application code never writes this field directly.
- `version` — optimistic concurrency counter for admin book edits.
- `updatedAt` — maintained on row modifications.

---

### `borrow_records`

```typescript
export const borrowRecords = pgTable("borrow_records", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  bookId: uuid("book_id").references(() => books.id).notNull(),
  borrowDate: timestamp("borrow_date", { withTimezone: true }).defaultNow().notNull(),
  dueDate: date("due_date").notNull(),
  returnDate: date("return_date"),
  borrowStatus: BORROW_STATUS_ENUM("borrow_status").default("PENDING").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }),
  isAdminCleared: boolean("is_admin_cleared").default(false).notNull(),
  dismissed: integer("dismissed").default(0).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("book_status_idx").on(table.bookId, table.borrowStatus),
  index("borrow_date_idx").on(table.borrowDate),
  index("reserved_at_idx").on(table.reservedAt),
]);
```

**Notable fields:**

- `reservedAt` — set to `NOW()` when a `PENDING` request is created. Used by the expiry logic to identify stale reservations older than 15 minutes.
- `isAdminCleared` — boolean flag; when `true` the record has been reviewed/cleared by an admin.
- `dismissed` — soft-delete flag (`0` or `1`). Users can dismiss completed records from their view without deleting the historical data.
- `version` — optimistic concurrency counter for status transitions. Prevents double-approve or double-return race conditions.
- `updatedAt` — maintained on every status transition.
- `bookStatusIdx` — composite index on `(bookId, borrowStatus)` supports availability checks and status-scoped queries.
- `borrowDateIdx` — supports admin borrow-record ordering and pagination.
- `reservedAtIdx` — supports the reservation-expiry scan.

---

### `app_settings`

Singleton configuration table. Enforces a single row via a boolean primary key (`id = true`) and multiple database-level `CHECK` constraints.

```typescript
export const appSettings = pgTable("app_settings", {
  id: boolean("id").primaryKey().default(true).notNull(),
  initializedAt: timestamp("initialized_at", { withTimezone: true }),
  setupCompleted: boolean("setup_completed").default(false).notNull(),
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  setupCompletedBy: uuid("setup_completed_by")
    .references(() => users.id, { onDelete: "restrict" }),
  borrowDurationDays: integer("borrow_duration_days").notNull(),
  supportEmail: varchar("support_email", { length: 255 }).notNull(),
  websiteUrl: text("website_url").notNull(),
  universityName: varchar("university_name", { length: 255 }).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("app_settings_singleton_chk", sql`${table.id} = true`),
  check("app_settings_borrow_duration_chk",
    sql`${table.borrowDurationDays} BETWEEN 1 AND 365`),
  check("app_settings_support_email_chk", sql`${table.supportEmail} <> ''`),
  check("app_settings_website_url_chk", sql`${table.websiteUrl} <> ''`),
  check("app_settings_university_name_chk", sql`${table.universityName} <> ''`),
  check("app_settings_no_reinit_chk",
    sql`${table.setupCompleted} = false OR ${table.initializedAt} IS NOT NULL`),
]);
```

**Notable fields:**

- `id = true` — the boolean primary key physically prevents a second row from being inserted.
- `initializedAt` — set during the setup wizard. `NULL` means the system has never been initialized.
- `setupCompletedAt` — timestamp of when setup was completed.
- `setupCompleted` — set to `true` at the end of the atomic setup transaction. Cached in Redis to redirect completed setups away from `/account` and `/setup`.
- `borrowDurationDays` — library-wide default used when calculating `dueDate` on new borrow requests.
- `supportEmail`, `websiteUrl`, `universityName` — all have `NOT NULL` and `CHECK` constraints preventing empty strings.
- `version` — optimistic concurrency counter for settings updates.
- `app_settings_no_reinit_chk` — ensures `setupCompleted` is never set without an `initializedAt`.

The `app_settings` row is read through `getSystemConfig()` (server) and cached in the Zustand `systemConfigStore` (client). See [Bookwise Setup Feature](Bookwise_Setup_Feature.md).

---

### `setup_events`

Append-only audit log of setup lifecycle events. Each row is immutable after insert.

```typescript
export const setupEvents = pgTable("setup_events", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  eventType: SETUP_EVENT_TYPE_ENUM("event_type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  requestId: uuid("request_id"),
  source: AUDIT_SOURCE_ENUM("source"),
  sessionId: text("session_id"),
  correlationId: uuid("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("setup_events_event_type_idx").on(table.eventType),
  index("setup_events_actor_user_id_idx").on(table.actorUserId),
  index("setup_events_created_at_idx").on(table.createdAt),
  index("setup_events_request_id_idx")
    .on(table.requestId)
    .where(sql`${table.requestId} IS NOT NULL`),
]);
```

**Notable fields:**

- `eventType` — typed via `SETUP_EVENT_TYPE_ENUM` (not free-text). Values: `SETUP_STARTED`, `OWNER_CREATED`, `SETTINGS_SAVED`, `SETUP_COMPLETED`, `SETUP_BLOCKED_ALREADY_INITIALIZED`.
- `actorUserId` — references `users.id` with `ON DELETE SET NULL`.
- `ipAddress` — stored as PostgreSQL `inet` type (not `text`).
- `requestId`, `source`, `sessionId`, `correlationId` — additional audit/tracing context.
- `request_id` has a partial index for efficient distributed-tracing lookups.

Four rows are inserted atomically as part of the setup transaction: `SETUP_STARTED`, `OWNER_CREATED`, `SETTINGS_SAVED`, `SETUP_COMPLETED`.

---

### `admin_audit_logs`

Tracks privileged admin actions.

```typescript
export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
  action: ADMIN_AUDIT_ACTION_ENUM("action").notNull(),
  previousValues: jsonb("previous_values"),
  newValues: jsonb("new_values"),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  requestId: uuid("request_id"),
  source: AUDIT_SOURCE_ENUM("source"),
  sessionId: text("session_id"),
  correlationId: uuid("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("admin_audit_logs_actor_user_id_idx").on(table.actorUserId),
  index("admin_audit_logs_target_user_id_idx").on(table.targetUserId),
  index("admin_audit_logs_action_idx").on(table.action),
  index("admin_audit_logs_created_at_idx").on(table.createdAt),
  index("admin_audit_logs_request_id_idx")
    .on(table.requestId)
    .where(sql`${table.requestId} IS NOT NULL`),
  index("admin_audit_logs_correlation_id_idx")
    .on(table.correlationId)
    .where(sql`${table.correlationId} IS NOT NULL`),
]);
```

**Notable fields:**

- `action` — typed via `ADMIN_AUDIT_ACTION_ENUM` (not free-text). Values: `ADMIN_CREATED`, `ADMIN_UPDATED`, `ADMIN_DEMOTED`, `ADMIN_DELETED`, `USER_STATUS_CHANGED`, `SETTINGS_UPDATED`.
- `actorUserId` / `targetUserId` — separate references for who performed the action and who it affected, both with `ON DELETE SET NULL`.
- `previousValues` / `newValues` — stores the before/after state as JSONB for full audit trail.
- `ipAddress` — stored as `inet` type.

---

## Relationships

```
users (1) ←— (N) borrow_records (N) —→ (1) books
users (1) ←— (N) setup_events (actorUserId)
users (1) ←— (N) admin_audit_logs (actorUserId / targetUserId)
users (1) —→ (1) app_settings (setupCompletedBy, ON DELETE RESTRICT)
```

---

## Borrowing Data Invariants

The implementation relies on these invariants being maintained by every mutation:

1. `available_copies = total_copies - borrowed_count - reserved_count` (enforced by the generated column).
2. `PENDING` requests consume `reserved_count`.
3. `BORROWED` records consume `borrowed_count`.
4. `REJECTED`, `RETURNED`, and `LATE_RETURN` consume neither counter.
5. `reserved_at` is set when a `PENDING` record is created and used to expire stale reservations after 15 minutes.
6. Counter updates are always wrapped in `GREATEST(0, ...)` guards to prevent underflow from race conditions.

---

## Optimistic Concurrency

Admin write paths use `updateWithVersionCheck()`:

```typescript
export const updateWithVersionCheck = async <TTable>({
  table, idColumn, versionColumn, id, expectedVersion, values, trx,
}: UpdateWithVersionCheckArgs<TTable> & { trx?: unknown }) => {
  const dbInstance = trx ? (trx as typeof db) : db;
  const result = await dbInstance
    .update(table as never)
    .set({
      ...values,
      updatedAt: new Date(),
      version: sql`${versionColumn} + 1`,
    } as never)
    .where(and(eq(idColumn, id), eq(versionColumn, expectedVersion)))
    .returning();

  const updatedRow = result[0];
  if (!updatedRow) {
    throw new Error(CONFLICT_ERROR_MESSAGE);
  }
  return updatedRow;
};
```

If another admin has already modified the row since it was loaded, the `WHERE version = expectedVersion` clause matches zero rows and `CONFLICT_ERROR_MESSAGE` (`"Update skipped — newer changes detected"`) is thrown. The admin must reload the row and retry.

**Note:** `updateWithVersionCheck` accepts an optional `trx` parameter to participate in an existing Drizzle transaction.

---

## Row Locking

Borrow-record mutation endpoints use a Redis-based row-locking mechanism to prevent concurrent admin edits. See `lib/admin/realtime/concurrency/rowConcurrency.ts` for the full implementation, which includes:

- **`acquireLock()`** — Lua-based atomic acquire with re-entrant support, TTL (60s), and heartbeat (20s).
- **`releaseLock()`** — compare-and-delete Lua script requiring both `adminId` and `token`.
- **`assertLockOwnership()`** — validates lock ownership before mutations; throws `LockOwnershipError` (HTTP 409) on violations.
- **`publishEvent()`** — publishes row mutations via Redis pub/sub for admin-panel realtime updates.

The lock key format is `lock:{entity}:{entityId}` in Redis.

---

## Query Patterns

All borrow-status mutations use `db.transaction()` with `SELECT ... FOR UPDATE` (not CTE-based single statements).

### Reserve a copy atomically

Uses `pg_advisory_xact_lock` for per-user/per-book serialization and a real transaction:

```typescript
const result = await db.transaction(async (tx) => {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${`borrow_request:${userId}:${bookId}`}))
  `);

  // Expire stale PENDING reservations for this book
  const expired = await tx.update(borrowRecords).set({
    borrowStatus: "REJECTED",
    updatedAt: new Date(),
    version: sql`${borrowRecords.version} + 1`,
  }).where(
    and(eq(borrowRecords.bookId, bookId),
        eq(borrowRecords.borrowStatus, "PENDING"),
        sql`${borrowRecords.reservedAt} < NOW() - INTERVAL '15 minutes'`),
  ).returning({ id: borrowRecords.id });

  if (expired.length > 0) {
    await tx.update(books).set({
      reservedCount: sql`GREATEST(0, ${books.reservedCount} - ${expired.length})`,
      updatedAt: new Date(),
      version: sql`${books.version} + 1`,
    }).where(eq(books.id, bookId));
  }

  // Increment reserved count if capacity available
  const [updatedBook] = await tx.update(books).set({
    reservedCount: sql`${books.reservedCount} + 1`,
    updatedAt: new Date(),
    version: sql`${books.version} + 1`,
  }).where(
    and(eq(books.id, bookId),
        sql`${books.reservedCount} + ${books.borrowedCount} < ${books.totalCopies}`),
  ).returning({
    availableCopies: books.availableCopies,
    reservedCount: books.reservedCount,
    borrowedCount: books.borrowedCount,
    version: books.version,
  });

  if (!updatedBook) {
    return { type: "unavailable" as const };
  }

  const [record] = await tx.insert(borrowRecords).values({
    userId, bookId, dueDate,
    borrowStatus: "PENDING",
    reservedAt: new Date(),
    borrowDate: new Date(),
  }).returning({ id: borrowRecords.id });

  return { type: "success" as const, record, updatedBook };
});
```

### Approve a request (PENDING → BORROWED)

Uses `db.transaction()` with `SELECT ... FOR UPDATE` row lock:

```typescript
const result = await db.transaction(async (tx) => {
  const [current] = await tx.select({
    id: borrowRecords.id,
    bookId: borrowRecords.bookId,
    borrowStatus: borrowRecords.borrowStatus,
  }).from(borrowRecords)
    .where(eq(borrowRecords.id, recordId))
    .limit(1)
    .for("update");

  await validateBorrowStatusTransition(current.borrowStatus, "BORROWED");

  const [updatedRecord] = await tx.update(borrowRecords).set({
    borrowStatus: "BORROWED",
    borrowDate: new Date(),
    dueDate,
    updatedAt: new Date(),
    version: sql`${borrowRecords.version} + 1`,
  }).where(
    and(eq(borrowRecords.id, recordId),
        eq(borrowRecords.borrowStatus, "PENDING"),
        eq(borrowRecords.version, expectedVersion)),
  ).returning({ id: borrowRecords.id, bookId: borrowRecords.bookId });

  const [updatedBook] = await tx.update(books).set({
    reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
    borrowedCount: sql`${books.borrowedCount} + 1`,
    updatedAt: new Date(),
    version: sql`${books.version} + 1`,
  }).where(eq(books.id, updatedRecord.bookId))
  .returning({
    availableCopies: books.availableCopies,
    reservedCount: books.reservedCount,
    borrowedCount: books.borrowedCount,
    version: books.version,
  });

  return { type: "success", updatedBook };
});
```

### Return a book (BORROWED → RETURNED / LATE_RETURN)

```typescript
const resolvedStatus = dayjs(today).isAfter(dayjs(current.dueDate), "day")
  ? "LATE_RETURN" : "RETURNED";

const result = await db.transaction(async (tx) => {
  const [updatedRecord] = await tx.update(borrowRecords).set({
    borrowStatus: resolvedStatus,
    returnDate: today,
    updatedAt: new Date(),
    version: sql`${borrowRecords.version} + 1`,
  }).where(
    and(eq(borrowRecords.id, recordId),
        eq(borrowRecords.borrowStatus, "BORROWED"),
        eq(borrowRecords.version, expectedVersion)),
  ).returning({ id: borrowRecords.id });

  const [updatedBook] = await tx.update(books).set({
    borrowedCount: sql`GREATEST(0, ${books.borrowedCount} - 1)`,
    updatedAt: new Date(),
    version: sql`${books.version} + 1`,
  }).where(eq(books.id, current.bookId))
  .returning({ /* ... */ });

  return { type: "success", updatedRecord, updatedBook };
});
```

### Reject a request (PENDING → REJECTED)

```typescript
const result = await db.transaction(async (tx) => {
  const [current] = await tx.select({ /* ... */ })
    .from(borrowRecords)
    .where(eq(borrowRecords.id, recordId))
    .limit(1)
    .for("update");

  await validateBorrowStatusTransition(current.borrowStatus, "REJECTED");

  const [updatedRecord] = await tx.update(borrowRecords).set({
    borrowStatus: "REJECTED",
    updatedAt: new Date(),
    version: sql`${borrowRecords.version} + 1`,
  }).where(
    and(eq(borrowRecords.id, recordId),
        eq(borrowRecords.borrowStatus, "PENDING"),
        eq(borrowRecords.version, expectedVersion)),
  ).returning({ id: borrowRecords.id, bookId: borrowRecords.bookId });

  const [updatedBook] = await tx.update(books).set({
    reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
    updatedAt: new Date(),
    version: sql`${books.version} + 1`,
  }).where(eq(books.id, updatedRecord.bookId))
  .returning({ /* ... */ });

  return { type: "success", current, updatedRecord, updatedBook };
});
```

---

## Migration History

The codebase uses a **single migration** (`0000_late_warhawk.sql`) that defines the complete schema — all 6 enums, all 6 tables, all indexes, and all CHECK constraints. This was generated by `drizzle-kit generate` after the schema was finalized.

| Migration | Key Changes |
|---|---|
| `0000_late_warhawk.sql` | Complete schema — enums (`status`, `role`, `borrow_status`, `setup_event_type`, `admin_audit_action`, `audit_source`), tables (`users`, `books`, `borrow_records`, `app_settings`, `setup_events`, `admin_audit_logs`), all indexes and constraints |

Migrations are managed with Drizzle Kit and applied via `npm run db:migrate`. The `drizzle.config.ts` loads environment from `.env.local` using `dotenv` and uses the `postgresql` dialect.

---

## Performance Notes

| Index | Table | Purpose |
|---|---|---|
| `available_copies_idx` | `books` | Availability-heavy filtering and sorting |
| `book_status_idx` | `borrow_records` | Status-scoped borrow queries (composite on `bookId`, `borrowStatus`) |
| `borrow_date_idx` | `borrow_records` | Admin borrow-record ordering and pagination |
| `reserved_at_idx` | `borrow_records` | Reservation-expiry scan |
| `users_role_idx` | `users` | Role-scoped admin queries |
| `users_status_idx` | `users` | Status-scoped user queries |
| `users_created_at_idx` | `users` | User listing and sorting by creation date |
| `users_university_id_idx` | `users` | Partial unique index (`WHERE university_id IS NOT NULL`) |
| `setup_events_event_type_idx` | `setup_events` | Filtering setup events by type |
| `setup_events_actor_user_id_idx` | `setup_events` | Lookup events by actor |
| `setup_events_created_at_idx` | `setup_events` | Event ordering |
| `setup_events_request_id_idx` | `setup_events` | Partial index for distributed tracing |
| `admin_audit_logs_actor_user_id_idx` | `admin_audit_logs` | Lookup audit entries by actor |
| `admin_audit_logs_target_user_id_idx` | `admin_audit_logs` | Lookup audit entries by target |
| `admin_audit_logs_action_idx` | `admin_audit_logs` | Filtering by action type |
| `admin_audit_logs_created_at_idx` | `admin_audit_logs` | Audit log ordering |
| `admin_audit_logs_request_id_idx` | `admin_audit_logs` | Partial index for distributed tracing |
| `admin_audit_logs_correlation_id_idx` | `admin_audit_logs` | Partial index for correlation tracing |

The generated `available_copies` column avoids repeated recomputation in application code while staying perfectly consistent with the counters at all times.

---

## Related Files

- `database/schema.ts` — complete Drizzle schema (all 6 tables, 6 enums, all indexes and constraints)
- `database/drizzle.ts` — database client (postgres-js driver with pooled connection)
- `database/redis.ts` — Redis client (Upstash Redis, used for row locks, realtime pub/sub, and caching)
- `database/seed.ts` — seed script for development
- `drizzle.config.ts` — Drizzle Kit configuration
- `migrations/` — migration SQL files
- `lib/actions/book.ts` — user-facing borrow actions
- `lib/admin/actions/borrow.ts` — admin borrow management actions
- `lib/admin/actions/user.ts` — admin user management actions
- `lib/admin/realtime/concurrency/rowConcurrency.ts` — `updateWithVersionCheck()`, row lock acquire/release, `publishEvent()`
