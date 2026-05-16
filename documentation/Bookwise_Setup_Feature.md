# BookWise: System Initialization & Setup Feature

## Overview

The setup feature is a one-time onboarding flow that initializes the BookWise application before it can be used. It creates the first admin (owner) account and configures core system settings. Once completed, the setup flow is permanently locked — it cannot be run again.

The flow is split across two pages:

1. **`/account`** — Create the admin account (name, email, password, optional avatar)
2. **`/setup`** — Answer configuration questions and finalize initialization

---

## Architecture

### Route Protection

**File:** `app/(system)/layout.tsx`

All setup-related pages are nested under the `(system)` layout group. On every request, this layout calls `refreshSetupStateCache()` to check whether the system has already been initialized. If it has, the user is immediately redirected to `/admin`, making the entire setup flow inaccessible post-initialization.

```
/account  ─┐
            ├─ (system) layout ── checks initialized state ── redirects to /admin if true
/setup    ─┘
```

### Setup State Caching

**Files:** `lib/global/setup-cache.ts`, `lib/global/setup-state.ts`

Setup state is stored in two places:

- **PostgreSQL** (`app_settings` table) — the source of truth
- **Upstash Redis** — a fast cache layer to avoid hitting the DB on every page load

`refreshSetupStateCache()` reads from the DB and writes to Redis atomically. If Redis is unavailable, the system falls back gracefully to `"unknown"` status and re-queries the DB.

---

## Pages

### 1. Account Creation — `/account`

**File:** `app/(system)/account/page.tsx`

Renders an `<AdminAuthForm>` that collects the admin's first name, last name, email, password, and an optional avatar. On submission, the values are **not** sent to the server yet — they are serialized to `sessionStorage` under the key `bookwise:setup-owner`.

This deferred approach keeps credentials out of the network until the final setup step, and allows the user to navigate back and forth between `/account` and `/setup` without losing their input.

**Stored draft shape (`SetupOwnerDraft`):**

| Field | Description |
|---|---|
| `fullName` | Combined first + last name |
| `email` | Admin email address |
| `password` | Plaintext password (hashed server-side on submit) |
| `userAvatar` | CDN URL of the uploaded avatar image |
| `userAvatarFileId` | ImageKit file ID (for future deletion) |

### 2. Setup Wizard — `/setup`

**File:** `app/(system)/setup/page.tsx`

A multi-step question wizard with the following flow:

```
Question 1 → Question 2 → Question 3 → Question 4 → Review Screen → Submit
                                                          ↑
                                               (Edit loops back to Q1)
```

#### Questions

| # | ID | Label | Type | Validation |
|---|---|---|---|---|
| 1 | `universityName` | Institute name | `text` | Required, non-empty |
| 2 | `websiteUrl` | Website URL | `url` | Valid URL format |
| 3 | `supportEmail` | Support email | `email` | Valid email format |
| 4 | `borrowDurationDays` | Borrow duration | `number` | Integer, 1–365 |

#### Modes

The wizard has two internal modes controlled by the `mode` state:

- **`"questions"`** — Shows one question at a time with forward/back navigation. Each field is validated on "Continue". Validation uses Zod schemas (`setupFieldSchemas`) matched against each question ID.
- **`"review"`** — Shows a summary of all answers with a warning that settings cannot be changed after submission. The user can click "Edit" to return to question 1 (entering `isEditableReview` mode, which changes the final question's submit button label to "Apply").

#### Final Submission

When the user confirms on the review screen, `handleFinalSubmit` runs:

1. Re-validates all answers client-side.
2. Reads the owner draft from `sessionStorage`.
3. If the draft is missing, redirects back to `/account`.
4. POSTs to `/api/setup` with the combined payload.
5. On success, calls `signIn("credentials", ...)` to automatically sign the new admin in.
6. Updates the in-memory `systemConfigStore` so the UI reflects the new settings immediately.
7. Clears the `sessionStorage` draft and redirects to `/admin`.

---

## API

### `POST /api/setup`

**File:** `app/api/setup/route.ts`

The single endpoint that performs the entire initialization in one atomic database transaction.

#### Request Body

```ts
{
  fullName: string;           // Admin's full name
  email: string;              // Admin's email
  password: string;           // Plaintext password (min 8 chars)
  userAvatar?: string | null; // Avatar CDN URL
  userAvatarFileId?: string | null;
  borrowDurationDays: number; // 1–365
  supportEmail: string;
  websiteUrl: string;
  universityName: string;
}
```

Validated via a Zod schema (`setupBodySchema`) before any DB work begins.

#### Database Transaction

The route uses a **serializable** transaction with a PostgreSQL advisory lock (`pg_try_advisory_xact_lock`) to ensure only one setup request can proceed at a time across all server instances. The transaction executes a single CTE chain with five stages:

| CTE | Operation | Guard |
|---|---|---|
| `guard` | Locks the `app_settings` row with `FOR UPDATE` | — |
| `insert_owner` | Inserts the admin user with `role = 'ADMIN'`, `status = 'APPROVED'` | Aborts if `initialized_at IS NOT NULL` or `setup_completed = true` |
| `mark_initialized` | Upserts `app_settings` with all config values and sets `setup_completed = true` | Only runs if `insert_owner` succeeded |
| `insert_events` | Inserts four `setup_events` rows: `SETUP_STARTED`, `OWNER_CREATED`, `SETTINGS_SAVED`, `SETUP_COMPLETED` | Only runs if `mark_initialized` succeeded |
| `insert_audit` | Inserts an `admin_audit_logs` row for `ADMIN_CREATED` | Only runs if `mark_initialized` succeeded |

If either the owner ID or settings ID comes back null (meaning the guard fired), the transaction throws and rolls back. This prevents double-initialization even under concurrent requests.

After the transaction, `refreshSetupStateCache()` is called to update Redis so subsequent requests reflect the new initialized state immediately.

#### Responses

| Status | Meaning |
|---|---|
| `200` | Setup completed successfully |
| `400` | Invalid request body (Zod validation failed) |
| `409` | System already initialized (`AlreadyInitializedError`) |
| `500` | Unexpected server error |

---

## Database Schema

### `app_settings` (singleton table)

The table enforces a single row via a boolean primary key (`id = true`) and a `CHECK` constraint. Key columns:

| Column | Type | Description |
|---|---|---|
| `id` | `boolean` | Always `true` — enforces singleton |
| `initialized_at` | `timestamptz` | Set when setup runs |
| `setup_completed` | `boolean` | `true` after successful setup |
| `setup_completed_by` | `uuid` | FK to the admin user created during setup |
| `borrow_duration_days` | `integer` | Library-wide default borrow duration |
| `support_email` | `varchar(255)` | Displayed in user-facing emails |
| `website_url` | `text` | Institute website |
| `university_name` | `varchar(255)` | Institute name |
| `version` | `integer` | Optimistic concurrency counter |

Database-level `CHECK` constraints enforce non-empty strings, valid borrow duration range, and the singleton invariant.

### `setup_events`

An append-only audit log of setup lifecycle events. Each event records the event type, actor user ID, IP address, user agent, and a JSON metadata blob with the `request_id` for traceability.

---

## Security

- **Pre-initialization guard:** `requireUninitialized()` is called at the top of the setup API route before any parsing or DB work. If the system is already initialized, a `409` is returned immediately.
- **Advisory lock:** `pg_try_advisory_xact_lock` prevents concurrent setup requests from both succeeding even under race conditions.
- **Serializable isolation:** The transaction runs at `SERIALIZABLE` isolation level, the strongest PostgreSQL offers.
- **Guard CTE:** The `guard` CTE acquires a `FOR UPDATE` row lock and the `insert_owner` CTE checks initialization state atomically within the same transaction, eliminating any TOCTOU window.
- **Password hashing:** The plaintext password from the request is hashed with `bcrypt` (cost factor 12) before being written to the database.
- **sessionStorage scoping:** The owner draft is stored in `sessionStorage` (not `localStorage`), so it is automatically cleared when the browser tab closes.

---

## Avatar Upload

**File:** `lib/global/essentials/use-avatar-upload.ts`

The `useAvatarUpload` hook powers the optional avatar upload in the account creation step. It handles the full lifecycle:

1. File selection via a hidden `<input type="file">` ref
2. MIME type validation against an allowlist
3. Interactive crop UI (via `react-easy-crop`)
4. Canvas-based image crop to a data URL
5. ImageKit upload using signed authentication params from `/api/auth/imagekit`
6. Returns a `{ url, fileId, fileName }` result to the parent form

The hook is generic and reusable — it accepts `folder`, `fileNamePrefix`, and `onUploadComplete` options, making it suitable for any avatar upload context in the app.

---

## File Map

```
app/
  (system)/
    layout.tsx                  # Guards setup routes; redirects if initialized
    account/page.tsx            # Step 1: admin account creation form
    setup/page.tsx              # Step 2: configuration wizard + review screen

app/api/
  setup/route.ts                # POST handler; atomic DB initialization

lib/global/
  setup-cache.ts                # Redis cache for setup state
  setup-state.ts                # DB read + cache refresh logic
  essentials/
    setup-questions.ts          # Question definitions and answer types
    system-config.ts            # SystemConfig type and defaults
    use-avatar-upload.ts        # Reusable avatar upload hook
  auth/
    require-uninitialized.ts    # Guard: throws if already initialized
    require-admin.ts            # Guard: validates admin session

database/
  schema.ts                     # app_settings, setup_events, users tables

migrations/
  0000_late_warhawk.sql         # Initial schema migration
```
