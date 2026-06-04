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

- **PostgreSQL** (`app_settings` table, `setup_completed` column) — the source of truth
- **Upstash Redis** — a fast cache layer to avoid a database round-trip on every page load

`refreshSetupStateCache()` reads from the database and writes the result to Redis atomically. If Redis is unavailable, the system falls back gracefully to `"unknown"` status and re-queries the database.

For the full `app_settings` schema see [Database](Database.md#app_settings-singleton).

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
| `password` | Plaintext password (hashed server-side on submit with bcrypt cost factor 12) |
| `userAvatar` | CDN URL of the uploaded avatar image |
| `userAvatarFileId` | ImageKit file ID (stored for future deletion on avatar update) |

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

- **`"questions"`** — Shows one question at a time with forward/back navigation. Each field is validated on "Continue" using Zod schemas (`setupFieldSchemas`) matched against each question ID.
- **`"review"`** — Shows a summary of all answers with a warning that settings cannot be changed after submission. Clicking "Edit" returns to question 1 (entering `isEditableReview` mode, which changes the final question's submit button label to "Apply").

#### Final Submission

When the user confirms on the review screen, `handleFinalSubmit` runs:

1. Re-validates all answers client-side.
2. Reads the owner draft from `sessionStorage`.
3. If the draft is missing, redirects back to `/account`.
4. `POST`s to `/api/setup` with the combined payload.
5. On success, calls `signIn("credentials", ...)` to automatically sign the new admin in.
6. Updates the in-memory `systemConfigStore` (Zustand) so the UI reflects the new settings immediately without a refresh. See [Components, Actions & Client Systems](Bookwise_Global_Configuration.md#system-config-store).
7. Clears the `sessionStorage` draft and redirects to `/admin`.

---

## API

### `POST /api/setup`

**File:** `app/api/setup/route.ts`

The single endpoint that performs the entire initialization in one atomic database transaction. Returns `409 Conflict` if the system is already initialized.

#### Request Body

```typescript
{
  fullName:           string;  // Admin's full name
  email:              string;  // Admin's email
  password:           string;  // Plaintext password (min 8 chars; hashed server-side)
  userAvatar?:        string | null;  // Avatar CDN URL
  userAvatarFileId?:  string | null;  // ImageKit file ID
  borrowDurationDays: number;  // 1–365
  supportEmail:       string;
  websiteUrl:         string;
  universityName:     string;
}
```

Validated via Zod schema (`setupBodySchema`) before any database work begins.

#### Database Transaction

The route uses a **serializable** transaction with a PostgreSQL advisory lock (`pg_try_advisory_xact_lock`) to ensure only one setup request can proceed at a time across all server instances. The transaction executes a single CTE chain with five stages:

| CTE | Operation | Guard |
|---|---|---|
| `guard` | Locks the `app_settings` row with `FOR UPDATE` | — |
| `insert_owner` | Inserts the admin user with `role = "ADMIN"`, `status = "APPROVED"`, bcrypt-hashed password (cost factor 12) | Aborts if `initialized_at IS NOT NULL` or `setup_completed = true` |
| `mark_initialized` | Upserts `app_settings` with all config values, sets `setup_completed = true` and `initialized_at = NOW()` | Only runs if `insert_owner` succeeded |
| `insert_events` | Inserts four `setup_events` rows: `SETUP_STARTED`, `OWNER_CREATED`, `SETTINGS_SAVED`, `SETUP_COMPLETED` | Only runs if `mark_initialized` succeeded |
| `insert_audit` | Inserts an `admin_audit_logs` row for `ADMIN_CREATED` | Only runs if `mark_initialized` succeeded |

If either the owner ID or settings ID comes back `null` (meaning the guard fired), the transaction throws and rolls back entirely. This prevents double-initialization even under concurrent requests.

After the transaction, `refreshSetupStateCache()` is called to update Redis so subsequent requests reflect the initialized state immediately.

#### Responses

| Status | Meaning |
|---|---|
| `200` | Setup completed successfully |
| `400` | Invalid request body (Zod validation failed) |
| `409` | System already initialized (`AlreadyInitializedError`) |
| `500` | Unexpected server error |

---

## Database Schema

For full table definitions see [Database](Database.md). The tables created or populated during setup are:

- **`app_settings`** — singleton row; `setup_completed = true` after successful initialization
- **`users`** — the admin owner is created with `role = "ADMIN"`, `status = "APPROVED"`
- **`setup_events`** — four audit rows inserted atomically with the transaction
- **`admin_audit_logs`** — one `ADMIN_CREATED` row for the owner account

### `app_settings` key columns

| Column | Set during setup |
|---|---|
| `initialized_at` | `NOW()` |
| `setup_completed` | `true` |
| `setup_completed_by` | Owner user UUID |
| `borrow_duration_days` | From wizard answer |
| `support_email` | From wizard answer |
| `website_url` | From wizard answer |
| `university_name` | From wizard answer |

---

## Security

- **Pre-initialization guard** — `requireUninitialized()` is called at the top of the setup API route before any parsing or database work. If the system is already initialized, `409` is returned immediately.
- **Advisory lock** — `pg_try_advisory_xact_lock` prevents concurrent setup requests from both succeeding even under race conditions.
- **Serializable isolation** — The transaction runs at `SERIALIZABLE` isolation level — the strongest PostgreSQL offers.
- **Guard CTE** — The `guard` CTE acquires a `FOR UPDATE` row lock; the `insert_owner` CTE checks initialization state atomically within the same transaction, eliminating any TOCTOU window.
- **Password hashing** — The plaintext password is hashed with bcrypt cost factor **12** before being written to the database. This matches the cost factor used in the regular sign-up flow.
- **`sessionStorage` scoping** — The owner draft is stored in `sessionStorage` (not `localStorage`), so it is automatically cleared when the browser tab closes.
- **`server-only` guard** — Server-only modules used in the setup flow are marked `import "server-only"` to prevent accidental inclusion in client bundles.

---

## Avatar Upload

**File:** `lib/global/essentials/use-avatar-upload.ts`

The `useAvatarUpload` hook powers the optional avatar upload in the account creation step. For the complete upload lifecycle and configuration options see [File Uploads](File_Uploads.md) and [Components, Actions & Client Systems](Bookwise_Global_Configuration.md#useavatarupload).

---

## System Config in Client Components

After setup completes, `handleFinalSubmit` calls `setSystemConfig()` on the Zustand store directly, so the admin's browser immediately reflects the new `instituteName`, `websiteUrl`, `supportEmail`, and `borrowDurationDays` without waiting for a page reload.

For subsequent page loads, `SystemConfigProvider` (rendered in the root layout) hydrates the store from a server-fetched `getSystemConfig()` call. See [Components, Actions & Client Systems](Bookwise_Global_Configuration.md#systemconfigprovider).

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
    setup-questions.ts          # Question definitions and Zod field schemas
    system-config.ts            # SystemConfig type and defaults
    use-avatar-upload.ts        # Reusable avatar upload hook
  auth/
    require-uninitialized.ts    # Guard: throws AlreadyInitializedError if initialized
    require-admin.ts            # Guard: validates admin session

database/
  schema.ts                     # app_settings, setup_events, users, admin_audit_logs

migrations/
  0000_late_warhawk.sql         # Initial schema migration
  0007_*.sql                    # Adds app_settings, setup_events, admin_audit_logs
```
