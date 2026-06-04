# BookWise Documentation

Welcome to the BookWise documentation. This index covers every document in the suite, organized by domain. Use the section headings to find what you need, or jump to [By Use Case](#by-use-case) for task-oriented navigation.

---

## Quick Start

If you are new to the codebase, read these four documents in order:

1. [Architecture](Architecture.md) — tech stack, project structure, design patterns, data flow
2. [Database](Database.md) — all tables, columns, migrations, and query patterns
3. [Authentication](Authentication.md) — NextAuth v5 config, JWT, session flow
4. [Borrowing System](Borrowing_System.md) — the core business domain: reservation, approval, return

---

## Documentation Index

### Architecture and Infrastructure

| Document                        | What it covers                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](Architecture.md) | Full tech stack, complete project structure tree, all route groups, design patterns, realtime signal-and-refresh model, security layers, caching strategy                                    |
| [Database](Database.md)         | All tables (`users`, `books`, `borrow_records`, `app_settings`, `setup_events`, `admin_audit_logs`), enums, version columns, migration history, query patterns, Neon HTTP driver constraints |
| [Deployment](Deployment.md)     | All environment variables (required, optional, removed), Vercel setup, database migrations, CI/CD, scaling considerations                                                                    |

---

### Authentication and Authorization

| Document                            | What it covers                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Authentication](Authentication.md) | NextAuth v5 config, sign-up/sign-in flows, JWT callbacks, `sessionVersion`, type extensions, security features                           |
| [Authorization](Authorization.md)   | RBAC roles and status, route layout protection, `requireAdminActor()`, lock ownership guard, all permission tables, role-change security |

---

### Core Features

| Document                                      | What it covers                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Borrowing System](Borrowing_System.md)       | Reservation-first lifecycle, counter model, all status transitions, lazy expiry, cron expiry, eligibility checks, realtime behavior, admin UI behavior, record dismissal                   |
| [Book Catalog](Book_Catalog.md)               | Book data model, counter-based availability, display components, search and filtering, admin CRUD, real-time availability, caching                                                         |
| [User Profile](User_Profile.md)               | Profile data model, avatar upload, account status flow, borrow history, dismissal, activity tracking, admin user management                                                                |
| [Receipt Generation](Receipt_Generation.md)   | `Receipt` type, `generateReceipt()` vs `getReceipt()`, `ReceiptModal`, PDF generation, rate limits, authorization                                                                          |
| [Email Notifications](Email_Notifications.md) | EmailJS setup, all five email templates and their triggers, Upstash Workflow return reminder, fire-and-forget pattern                                                                      |
| [File Uploads](File_Uploads.md)               | ImageKit config, `useAvatarUpload` hook, full upload flow, `AvatarUploadControls`/`ImageCropper` two-mode architecture, university card upload, book cover upload, validation, rate limits |

---

### Admin Dashboard

| Document                                                        | What it covers                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Admin Dashboard](Admin_Dashboard.md)                           | Dashboard layout, `SessionGuard`, statistics, user/book/borrow management, row locking overview, correct API endpoint paths, aspirational features marked |
| [Admin Dashboard Optimization](Admin_Dashboard_Optimization.md) | `PartialTableWrapper`, `RowSkeleton`, table header components, `SearchContext`, optimistic borrow updates, paginated borrow query                         |
| [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md)         | Redis pub/sub signal-and-refresh pattern, per-instance broker, SSE stream, `useAdminDashboardRealtime` hook, environment variables, failure modes         |

---

### Realtime System

| Document                                                    | What it covers                                                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Realtime System Guide](Realtime_System_Guide.md)           | Complete overview with architecture diagram, all three subsystems, key concepts, event flow examples, configuration, troubleshooting                                             |
| [Realtime Client SSE](Realtime_Client_SSE.md)               | Singleton `EventSource`, reference counting, exponential backoff, heartbeat detection, periodic resync, connection state machine                                                 |
| [Admin Row Concurrency](Admin_Row_Concurrency.md)           | Redis-backed distributed locks, `acquireLock`/`refreshLock`/`releaseLock`, Lua scripts, `assertLockOwnership`, `LockOwnershipError`, `updateWithVersionCheck`, `useRowLock` hook |
| [Admin Realtime Events](Admin_Realtime_Events.md)           | `AdminRealtimeRowEvent`, `AdminRealtimeLockEvent`, `AdminRealtimeHeartbeatEvent`, channels, SSE encoding, type guards, event flow                                                |
| [Admin Realtime API Routes](Admin_Realtime_API_Routes.md)   | `GET /api/admin/realtime/rows`, `GET /api/admin/sync`, `GET\|POST\|PATCH\|DELETE /api/admin/locks` — full request/response documentation                                         |
| [Realtime Hooks](Realtime_Hooks.md)                         | `useRealtimeCore`, `useRowLock`, `useRealtimeUpdates`, `useOptimisticUpdate` — signatures, lifecycle, usage examples                                                             |
| [Realtime Book Availability](Realtime_Book_Availability.md) | Supplementary detail on the public book stream — SSE wire format, `Last-Event-ID` replay, server architecture, client-side usage                                                 |
| [Admin Session Invalidation](Admin_Session_Invalidation.md) | `session_version` column, `publishRoleChangeEvent`, SSE stream events, `useSessionInvalidation` hook, `SessionGuard` component, security notes                                   |

---

### API Reference

| Document                          | What it covers                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [API Reference](API_Reference.md) | Complete endpoint catalogue: setup, auth, borrowing, book stream, cron, user, admin dashboard, admin session, admin realtime, admin book/user server actions, receipts, status types, rate limit summary |

---

### System Setup

| Document                                                                 | What it covers                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bookwise Setup Feature](Bookwise_Setup_Feature.md)                      | One-time initialization flow, `/account` + `/setup` pages, `POST /api/setup`, CTE transaction stages, `app_settings` schema summary, security model, avatar upload in setup context                                                                            |
| [Components, Actions & Client Systems](Bookwise_Global_Configuration.md) | `AdminAuthForm`, `ImageCropper`, `AvatarUploadControls`, `UserProfile`, `ReceiptModal`, `SystemConfigProvider`, `Sidebar`, `useAvatarUpload` hook, `systemConfigStore`, all server actions (`borrowBook`, `generateReceipt`, user management), `getCroppedImg` |

---

### Performance

| Document                                                        | What it covers                                                                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Performance Improvements](Performance_Improvements.md)         | Bundle splitting (lazy components), `PrefetchOnIntentLink`, LCP image size constants, search/pagination URL helpers, borrow status CTE compatibility, impact summary |
| [Cache and Search Consistency](Cache_and_Search_Consistency.md) | `CACHE_TAGS`, all cached query helpers, complete revalidation call-site tables, search query routing, `SearchFilter` URL pattern, admin dashboard parallel queries   |
| [Top Loader Navigation](Top_Loader_Navigation.md)               | `nprogress` integration with App Router, click detection, route-change synchronisation, `navigateWithTopLoader`, edge cases, maintenance notes                       |

---

### Rate Limiting

| Document                          | What it covers                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Rate Limiting](Rate_Limiting.md) | All rate limit instances and configurations, identity model, SSE connection leases, algorithm selection rationale, `SKIP_RATE_LIMIT` warning, response headers, best practices |

---

### Testing

| Document                                                        | What it covers                                                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TESTING](TESTING.md)                                           | Playwright E2E: philosophy, architecture, fixture inheritance, mocking strategy, all critical user journeys, best practices, CI/CD workflow, debugging, anti-patterns |
| [UNIT AND INTEGRATION TESTING](UNIT_AND_INTEGRATION_TESTING.md) | Vitest unit + integration: test pyramid, configuration, `InMemoryDb` mock, fixture factories, assertion helpers, all test file deep dives, CI/CD integration          |

---

## By Use Case

### "I want to understand how the system works end-to-end"

→ [Architecture](Architecture.md) → [Database](Database.md) → [Borrowing System](Borrowing_System.md)

### "I'm setting up the project for the first time"

→ [Deployment](Deployment.md) → [Bookwise Setup Feature](Bookwise_Setup_Feature.md)

### "I'm debugging a realtime / SSE issue"

→ [Realtime System Guide](Realtime_System_Guide.md) → [Realtime Client SSE](Realtime_Client_SSE.md) (Troubleshooting section)

### "I need to understand the admin row locking system"

→ [Admin Row Concurrency](Admin_Row_Concurrency.md) → [Admin Realtime API Routes](Admin_Realtime_API_Routes.md)

### "I'm building a new admin table component"

→ [Realtime Hooks](Realtime_Hooks.md) → [Admin Realtime Events](Admin_Realtime_Events.md) → [Admin Dashboard](Admin_Dashboard.md)

### "I need to add a new API endpoint"

→ [API Reference](API_Reference.md) → [Authorization](Authorization.md) → [Rate Limiting](Rate_Limiting.md)

### "I'm investigating a database / inventory inconsistency"

→ [Database](Database.md) → [Borrowing System](Borrowing_System.md)

### "I need to work on the avatar upload flow"

→ [File Uploads](File_Uploads.md) → [Components, Actions & Client Systems](Bookwise_Global_Configuration.md#useavatarupload)

### "I'm implementing or debugging session invalidation"

→ [Admin Session Invalidation](Admin_Session_Invalidation.md) → [Authentication](Authentication.md#real-time-session-invalidation)

### "I'm working on the public book availability stream"

→ [Book Availability Realtime](Book_Availability_Realtime.md) → [Realtime Book Availability](Realtime_Book_Availability.md)

### "I'm writing or debugging tests"

→ [TESTING](TESTING.md) (E2E) or [UNIT AND INTEGRATION TESTING](UNIT_AND_INTEGRATION_TESTING.md) (unit/integration)

### "I need to troubleshoot the admin dashboard not refreshing"

→ [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md) (Troubleshooting section)

---

## Key Concepts Map

```
Architecture (overview)
    ├── Database (schema + queries)
    ├── Authentication (session + JWT)
    ├── Authorization (RBAC + locks)
    │
    ├── Borrowing System (core domain)
    │       ├── Book Catalog (inventory model)
    │       ├── Receipt Generation
    │       └── Email Notifications
    │
    ├── Admin Dashboard
    │       ├── Admin Dashboard Optimization
    │       └── Admin Dashboard Realtime
    │
    ├── Realtime System Guide (overview)
    │       ├── Realtime Client SSE
    │       ├── Admin Row Concurrency
    │       ├── Admin Realtime Events
    │       ├── Admin Realtime API Routes
    │       ├── Realtime Hooks
    │       ├── Book Availability Realtime
    │       └── Admin Session Invalidation
    │
    ├── Performance
    │       ├── Performance Improvements
    │       ├── Cache and Search Consistency
    │       └── Top Loader Navigation
    │
    └── Setup
            ├── Bookwise Setup Feature
            └── Components, Actions & Client Systems
```

---

## Document File Naming Convention

```
Architecture_*.md        → System-wide architecture documents
Admin_*.md               → Admin-specific features and infrastructure
Realtime_*.md            → Client/connection realtime layer
Book_*.md                → Book catalog and availability
Bookwise_*.md            → Application-wide configuration and setup
TESTING.md               → E2E test guide (Playwright)
UNIT_AND_INTEGRATION_TESTING.md → Unit/integration test guide (Vitest)
```

---

## Document Health

All documents were audited against source code in June 2026. The following known gaps are tracked for future resolution:

| Item                                                                           | Status                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Migration files `0001`–`0003` contents                                         | Not documented — Verification Required                                   |
| `GET /api/user/profile` / `PUT /api/user/profile` — API route vs server action | Verification Required; noted in `API_Reference.md` and `User_Profile.md` |
| QStash retry policy configuration                                              | Configured in Upstash dashboard; noted in `Email_Notifications.md`       |
