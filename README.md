# BookWise

A full-stack university library management system built with Next.js App Router. BookWise handles the complete borrowing lifecycle — from account approval through reservation, approval, return, and receipt — with a multi-layer realtime system that keeps all admin sessions and public book pages synchronized without polling.

---

## Features

### For Students

- **Registration with ID verification** — sign up with a university ID card image; account requires admin approval before borrowing is enabled
- **Book discovery** — browse, search, and filter the catalog by title, author, and genre with server-cached results
- **Reservation-first borrowing** — submit a borrow request that immediately reserves a copy; no overbooking under concurrent requests
- **Real-time availability** — book detail pages update available copy counts live via Server-Sent Events without a page reload
- **Borrow history and receipts** — view all past and active borrows; download PDF receipts for approved loans
- **Profile and avatar** — update profile picture with an interactive crop tool backed by ImageKit CDN

### For Administrators

- **Account approval queue** — review university ID card images, approve or reject pending accounts
- **Book catalog management** — create, edit, and delete books with cover images, video trailers, and copy counts
- **Borrow oversight** — approve and reject pending requests, process returns, generate receipts
- **Live admin dashboard** — statistics refresh automatically across all open admin sessions via Redis pub/sub + SSE; no manual refresh needed
- **Row-level concurrency control** — distributed Redis locks prevent two admins from editing the same record simultaneously; "Currently being edited by Jane Admin" indicators visible to all
- **Optimistic table updates** — status changes apply instantly with automatic rollback on conflict
- **Session invalidation** — when an admin's role is revoked, all their active browser tabs are signed out immediately via SSE — no waiting for JWT expiry

### Technical Highlights

- **Counter-based inventory model** — `availableCopies` is a PostgreSQL generated column (`totalCopies - borrowedCount - reservedCount`); never written directly, always consistent
- **Atomic SQL on Neon HTTP** — borrow status transitions use single-statement CTEs because `db.transaction()` is not supported by the Neon HTTP driver
- **Optimistic concurrency** — every admin write uses a `version` column check; concurrent edits surface a clear conflict error
- **Three-tier realtime system** — admin row events, admin dashboard signals, and public book availability each run on separate Redis channels with appropriate auth levels
- **Tag-based cache invalidation** — `books` and `users` tags are revalidated at every mutation site for consistent public-facing data
- **Setup wizard** — one-time initialization flow protected by a PostgreSQL advisory lock and a guard CTE; cannot be re-run on a live system
- **Reservation expiry** — pending requests older than 15 minutes are reclaimed lazily on new requests and via a scheduled cron endpoint

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router, Server Actions, Server Components) |
| Language | TypeScript |
| UI | React, Tailwind CSS, Radix UI, Lucide React |
| Auth | NextAuth.js v5 — JWT sessions, credentials provider |
| Database | PostgreSQL via Neon (serverless HTTP driver) |
| ORM | Drizzle ORM + Drizzle Kit migrations |
| Cache / Realtime | Upstash Redis — rate limiting, pub/sub, distributed locks, SSE connection leases |
| Workflows | Upstash QStash — durable return-reminder emails |
| Media | ImageKit — CDN, avatar upload with crop, book covers |
| Email | EmailJS — transactional email delivery |
| Deployment | Vercel |

---

## Project Structure

```
bookwise/
├── app/
│   ├── (auth)/                       # Sign-in and sign-up pages
│   ├── (root)/                       # Protected user-facing pages
│   ├── (system)/                     # One-time setup wizard (locked after init)
│   ├── admin/                        # Admin dashboard pages
│   └── api/
│       ├── auth/                     # NextAuth + ImageKit auth
│       ├── avatar/                   # Avatar update
│       ├── book/
│       │   ├── requests/[id]/        # Approve / reject / return
│       │   ├── stream/               # Public SSE — live availability
│       │   └── cron/                 # Reservation expiry cron
│       ├── admin/
│       │   ├── dashboard/            # Snapshot + SSE refresh signal
│       │   ├── realtime/rows/        # Admin row-level SSE stream
│       │   ├── locks/                # Distributed row lock management
│       │   ├── sync/                 # Post-reconnect state resync
│       │   └── session/realtime/     # Session invalidation SSE
│       ├── receipt/                  # PDF receipt download
│       ├── setup/                    # One-time initialization
│       └── workflows/                # Upstash Workflow handlers
│
├── components/
│   ├── admin/
│   │   ├── context/                  # SearchContext
│   │   ├── dashboard/                # AdminDashboardRealtime, Statistics
│   │   ├── forms/                    # BookForm, AdminAuthForm
│   │   ├── shared/                   # RowLockIndicator, PartialTableWrapper
│   │   ├── skeleton/                 # RowSkeleton
│   │   └── tables/                   # BorrowTable, UserTable, BookTable, AccountTable
│   ├── book/                         # BookCard, BookOverview, BorrowBook
│   ├── ui/                           # Shadcn UI primitives
│   ├── SessionGuard.tsx              # Mounts session invalidation hook
│   ├── SystemConfigProvider.tsx      # Hydrates Zustand config store
│   ├── TopLoader.tsx                 # nprogress navigation bar
│   └── UserProfile.tsx
│
├── database/
│   ├── schema.ts                     # Drizzle schema (all tables + enums)
│   ├── drizzle.ts                    # Neon HTTP client
│   └── seed.ts                       # Development seed script
│
├── lib/
│   ├── actions/                      # User server actions
│   ├── admin/
│   │   ├── actions/                  # Admin server actions
│   │   └── realtime/                 # SSE broker, pub/sub, hooks, locks
│   ├── essentials/                   # Rate limiting, validation, utilities
│   ├── global/                       # Setup state, system config, auth guards
│   ├── performance/                  # Bundle splitting, cache, LCP, navigation
│   ├── realtime/                     # Singleton SSE client
│   ├── store/                        # Zustand system config store
│   ├── auth.ts                       # NextAuth v5 config
│   ├── config.ts                     # Environment variable bindings
│   ├── validations.ts                # Zod schemas
│   └── workflow.ts                   # Upstash Workflow client
│
├── migrations/                       # Drizzle migration SQL files
├── documentation/                    # Full documentation suite (see below)
├── tests/
│   ├── e2e/                          # Playwright end-to-end tests
│   ├── unit/                         # Vitest unit tests
│   └── integration/                  # Vitest integration tests (InMemoryDb)
└── drizzle.config.ts
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) PostgreSQL database
- An [Upstash](https://upstash.com) Redis instance
- An [Upstash QStash](https://upstash.com/qstash) project
- An [ImageKit](https://imagekit.io) account
- An [EmailJS](https://emailjs.com) account

### 1. Clone and install

```bash
git clone https://github.com/your-org/bookwise.git
cd bookwise
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```env
# Database
DATABASE_URL=postgresql://user:password@host/database

# Authentication (NextAuth v5)
AUTH_SECRET=your-nextauth-secret
AUTH_URL=http://localhost:3000

# ImageKit
IMAGEKIT_PUBLIC_KEY=your-public-key
IMAGEKIT_PRIVATE_KEY=your-private-key
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your-id

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Upstash QStash
UPSTASH_QSTASH_URL=https://qstash.upstash.io
UPSTASH_QSTASH_TOKEN=your-token

# EmailJS
EMAILJS_SERVICE_ID=your-service-id
EMAILJS_PUBLIC_KEY=your-public-key
EMAILJS_PRIVATE_KEY=your-private-key
EMAILJS_WELCOME_TEMPLATE_ID=template-id
EMAILJS_APPROVAL_TEMPLATE_ID=template-id
EMAILJS_REJECTION_TEMPLATE_ID=template-id
EMAILJS_BORROW_APPROVED_TEMPLATE_ID=template-id
EMAILJS_RETURN_REMINDER_TEMPLATE_ID=template-id

# Application URL
APP_URL=http://localhost:3000

# Optional — guards the reservation-expiry cron endpoint
# CRON_SECRET=your-cron-secret
```

See [Deployment](./documentation/Deployment.md) for the full variable reference including removed legacy variables.

### 3. Run migrations and seed

```bash
npm run db:migrate   # Apply all Drizzle migrations
npm run seed         # Seed sample book data (optional)
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first time you visit, you will be redirected to the setup wizard (`/account` → `/setup`) to create the admin account and configure system settings.

### 5. Run tests

```bash
npm run test                  # Vitest unit tests
npm run test:integration      # Vitest integration tests
npx playwright test           # Playwright E2E tests
```

---

## Realtime Architecture

BookWise has three independent realtime channels, each scoped to its audience:

```
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│ Admin Row Realtime              │   │ Admin Dashboard Realtime        │
│ • Distributed row locks (60s)   │   │ • Refresh signal after mutation │
│ • CREATE/UPDATE/DELETE events   │   │ • Per-instance broker fanout    │
│ • Version conflict detection    │   │ • 3s batching window            │
│ GET /api/admin/realtime/rows    │   │ GET /api/admin/dashboard/realtime│
└─────────────────────────────────┘   └─────────────────────────────────┘
         ↑ Authenticated admins                ↑ Authenticated admins

┌─────────────────────────────────┐
│ Book Availability Realtime      │
│ • BOOK_UPDATED events           │
│ • 250-event replay buffer       │
│ • Rate-limited by IP            │
│ GET /api/book/stream            │
└─────────────────────────────────┘
         ↑ Public (no auth required)
```

All three channels use Upstash Redis pub/sub on the backend. The admin streams require an authenticated `ADMIN` session; the book stream is public but rate-limited (2 concurrent connections per IP).

For full architecture details see [Realtime System Guide](./documentation/Realtime_System_Guide.md).

---

## Database Schema

Five tables power the application:

| Table | Purpose |
|---|---|
| `users` | Accounts, roles, statuses, avatar, `version`, `session_version` |
| `books` | Catalog, `borrowedCount`, `reservedCount`, generated `availableCopies`, `version` |
| `borrow_records` | Reservation → loan → return lifecycle, `reservedAt`, `dismissed`, `version` |
| `app_settings` | Singleton system config (borrow duration, support email, institute name) |
| `setup_events` | Append-only audit log of initialization events |

`availableCopies` is a **generated column** — never written directly:

```sql
available_copies INTEGER GENERATED ALWAYS AS
  (total_copies - borrowed_count - reserved_count) STORED
```

See [Database](./documentation/Database.md) for full schema, migration history, and query patterns.

---

## Documentation

Full documentation lives in the `documentation/` folder. Start with the [Documentation Index](./documentation/README.md) or jump directly to a topic:

### Core

- [Architecture](./documentation/Architecture.md) — tech stack, project structure, design patterns, data flow
- [Database](./documentation/Database.md) — all tables, columns, migrations, query patterns
- [Authentication](./documentation/Authentication.md) — NextAuth v5, JWT, `sessionVersion`, sign-up/sign-in flows
- [Authorization](./documentation/Authorization.md) — RBAC, route protection, lock ownership guard, permission tables

### Features

- [Borrowing System](./documentation/Borrowing_System.md) — reservation lifecycle, status transitions, expiry, eligibility
- [Book Catalog](./documentation/Book_Catalog.md) — inventory model, search, caching, real-time availability
- [User Profile](./documentation/User_Profile.md) — avatar upload, borrow history, account status
- [Admin Dashboard](./documentation/Admin_Dashboard.md) — layout, statistics, borrow/user/book management
- [Receipt Generation](./documentation/Receipt_Generation.md) — `generateReceipt()`, PDF download
- [Email Notifications](./documentation/Email_Notifications.md) — templates, trigger points, return reminder workflow
- [File Uploads](./documentation/File_Uploads.md) — ImageKit integration, avatar crop pipeline, validation

### Realtime

- [Realtime System Guide](./documentation/Realtime_System_Guide.md) — complete overview with diagrams and event flow examples
- [Admin Row Concurrency](./documentation/Admin_Row_Concurrency.md) — distributed locks, version conflict detection
- [Admin Dashboard Realtime](./documentation/Admin_Dashboard_Realtime.md) — Redis pub/sub signal-and-refresh
- [Admin Session Invalidation](./documentation/Admin_Session_Invalidation.md) — forced sign-out on role change via SSE
- [Book Availability Realtime](./documentation/Book_Availability_Realtime.md) — public SSE stream, replay buffer

### API and Infrastructure

- [API Reference](./documentation/API_Reference.md) — complete endpoint catalogue
- [Rate Limiting](./documentation/Rate_Limiting.md) — all limiters, SSE connection leases, identity model
- [Deployment](./documentation/Deployment.md) — environment variables, Vercel setup, CI/CD

### Performance and Testing

- [Performance Improvements](./documentation/Performance_Improvements.md) — bundle splitting, LCP, prefetching
- [Cache and Search Consistency](./documentation/Cache_and_Search_Consistency.md) — tag-based invalidation, search routing
- [Top Loader Navigation](./documentation/Top_Loader_Navigation.md) — nprogress with App Router
- [TESTING](./documentation/TESTING.md) — Playwright E2E guide
- [Unit and Integration Testing](./documentation/UNIT_AND_INTEGRATION_TESTING.md) — Vitest guide, `InMemoryDb`

---

## Acknowledgements

- [Next.js](https://nextjs.org/) — React framework
- [Neon](https://neon.tech/) — serverless PostgreSQL
- [Upstash](https://upstash.com/) — Redis and QStash
- [ImageKit](https://imagekit.io/) — media CDN
- [Vercel](https://vercel.com/) — deployment platform
- [Tailwind CSS](https://tailwindcss.com/) — CSS framework
- [Drizzle ORM](https://orm.drizzle.team/) — type-safe ORM
- [NextAuth.js](https://authjs.dev/) — authentication

---

Built with Next.js and the technologies listed above.
