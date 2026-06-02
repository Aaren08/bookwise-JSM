# Architecture

## Overview

BookWise is a modern full-stack library management system built with Next.js App Router, featuring a robust architecture that separates concerns between the client and server while maintaining type safety throughout. The system includes a multi-layer realtime infrastructure for admin collaboration, dashboard synchronization, and public book availability streaming.

## Tech Stack

### Frontend

- **Next.js** (App Router) — React framework with Server and Client Components
- **React** — UI library with Server Components as the default
- **Tailwind CSS** — Utility-first CSS framework
- **Radix UI** — Accessible component primitives
- **Lucide React** — Icon library
- **Zustand** — Client-side state management (system config store)
- **nprogress** — Top-loading bar for navigation feedback

> **Version note:** The exact Next.js version is tracked in `package.json`. All architecture patterns in this document use the App Router (`app/` directory), Server Actions (`"use server"`), and the `after()` hook — features available from Next.js 14 onward.

### Backend

- **Next.js API Routes** — Serverless route handlers
- **NextAuth.js v5** — Authentication with JWT sessions
- **Drizzle ORM** — Type-safe database ORM
- **Neon Database** — Serverless PostgreSQL via HTTP driver
- **Upstash Redis** — Rate limiting, caching, distributed locks, and pub/sub for realtime
- **Upstash QStash** — Workflow orchestration for email scheduling

### Infrastructure

- **Upstash Redis Pub/Sub + SSE** — Realtime signaling for admin dashboard, row-level concurrency, and session invalidation
- **ImageKit** — Image and video CDN with client-side upload SDK
- **EmailJS** — Transactional email delivery

---

## Project Structure

```
bookwise/
├── app/                              # Next.js App Router
│   ├── (auth)/                       # Public authentication routes
│   │   ├── layout.tsx                # Redirects authenticated users to /
│   │   ├── sign-in/
│   │   └── sign-up/
│   ├── (root)/                       # Protected user-facing routes
│   │   ├── layout.tsx                # Requires authenticated session
│   │   ├── page.tsx                  # Home page
│   │   ├── my-profile/
│   │   ├── search/
│   │   └── books/[id]/
│   ├── (system)/                     # One-time setup wizard (locked after init)
│   │   ├── layout.tsx                # Redirects to /admin if already initialized
│   │   ├── account/                  # Step 1: admin account creation
│   │   └── setup/                    # Step 2: system configuration wizard
│   ├── admin/                        # Admin dashboard routes
│   │   ├── layout.tsx                # Requires ADMIN role + mounts SessionGuard
│   │   ├── page.tsx                  # Dashboard home
│   │   ├── users/
│   │   ├── books/
│   │   ├── borrow-records/
│   │   └── account-requests/
│   ├── api/                          # API route handlers
│   │   ├── auth/                     # NextAuth handlers + ImageKit auth endpoint
│   │   ├── avatar/                   # Avatar upload and update
│   │   ├── receipt/                  # Receipt download
│   │   ├── workflows/                # Upstash Workflow handlers (return reminders)
│   │   ├── setup/                    # POST — one-time system initialization
│   │   ├── books/                    # Public book catalog (GET /api/books, /api/books/[id])
│   │   ├── book/
│   │   │   ├── requests/             # POST — create borrow request
│   │   │   │   └── [id]/
│   │   │   │       ├── approve/      # PATCH — approve request
│   │   │   │       ├── reject/       # PATCH — reject request
│   │   │   │       └── return/       # PATCH — return book
│   │   │   ├── stream/               # GET — public SSE inventory stream
│   │   │   └── cron/
│   │   │       └── expire-reservations/  # GET — stale reservation cleanup
│   │   ├── user/                     # User profile and borrow-record endpoints
│   │   ├── borrow-records/           # PUT /[id]/dismiss
│   │   └── admin/
│   │       ├── dashboard/            # GET — snapshot; realtime/ — SSE stream
│   │       ├── realtime/rows/        # GET — admin row-level SSE stream
│   │       ├── locks/                # GET/POST/PATCH/DELETE — row lock management
│   │       ├── sync/                 # GET — post-reconnect state resync
│   │       └── session/realtime/     # GET — session invalidation SSE stream
│   ├── layout.tsx                    # Root layout
│   ├── not-found.tsx
│   └── too-fast/                     # Rate limit exceeded page
│
├── components/                       # React components
│   ├── admin/                        # Admin-specific components
│   │   ├── context/                  # SearchContext
│   │   ├── dashboard/                # AdminDashboardRealtime, Statistics
│   │   ├── forms/                    # BookForm, AdminAuthForm
│   │   ├── shared/                   # RowLockIndicator, PartialTableWrapper
│   │   ├── skeleton/                 # RowSkeleton
│   │   └── tables/                   # BorrowTable, UserTable, BookTable, AccountTable
│   │       └── table-header/         # BookTableHeader, UserTableHeader, etc.
│   ├── book/                         # Book-related components (BookCard, BookOverview, etc.)
│   ├── ui/                           # Shadcn UI primitives
│   ├── AuthForm.tsx
│   ├── ImageCropper.tsx
│   ├── AvatarUploadControls.tsx
│   ├── ReceiptModal.tsx
│   ├── SessionGuard.tsx              # Mounts session invalidation hook
│   ├── SystemConfigProvider.tsx      # Hydrates Zustand store from server config
│   ├── TopLoader.tsx                 # nprogress navigation bar
│   └── UserProfile.tsx
│
├── database/                         # Database configuration
│   ├── drizzle.ts                    # Drizzle client
│   ├── redis.ts                      # Upstash Redis client
│   ├── schema.ts                     # Full Drizzle schema
│   └── seed.ts                       # Development seed script
│
├── lib/                              # Server and shared utilities
│   ├── actions/                      # User-facing server actions
│   ├── admin/
│   │   ├── actions/                  # Admin server actions (book, borrow, user, receipt)
│   │   └── realtime/                 # Realtime infrastructure
│   │       ├── concurrency/          # Row locks, events, hooks, sync fetchers
│   │       ├── session/              # Session invalidation publisher + hook
│   │       ├── dashboardRedisPubSub.ts
│   │       ├── dashboardRealtimeBroker.ts
│   │       ├── dashboardRealtimeEvents.ts
│   │       ├── dashboardSocketServer.ts  # Compatibility wrapper for broadcast calls
│   │       └── useAdminDashboardRealtime.ts
│   ├── essentials/                   # Shared utilities (rate limit, sanitize, download)
│   ├── global/                       # Setup state, system config, auth guards
│   │   ├── setup-cache.ts            # Redis cache for setup state
│   │   ├── setup-state.ts            # DB read + cache refresh
│   │   ├── auth/                     # requireAdminActor(), requireUninitialized()
│   │   └── essentials/               # Setup questions, system config type, avatar hook
│   ├── performance/                  # Bundle splitting, LCP, navigation, top loader
│   │   ├── bundle.tsx                # Lazy-loaded heavy components
│   │   ├── cache.ts                  # Cached query helpers + CACHE_TAGS
│   │   ├── lcp.ts                    # Responsive image size constants
│   │   ├── navigation.ts             # Search/pagination URL builders
│   │   ├── PrefetchOnIntentLink.tsx  # Hover/focus prefetch link wrapper
│   │   └── top-loader.ts             # NProgress controller
│   ├── realtime/
│   │   └── realtimeClient.ts         # Singleton SSE client (reference-counted)
│   ├── store/
│   │   └── system-config-store.ts    # Zustand store with localStorage persistence
│   ├── config.ts                     # Environment variable config
│   ├── emailjs.ts                    # Email sending utility
│   ├── validations.ts                # Zod schemas
│   ├── utils.ts                      # Shared helper functions
│   └── workflow.ts                   # Upstash Workflow client
│
├── migrations/                       # Drizzle migration SQL files
├── public/                           # Static assets (icons, images)
├── constants/                        # App-wide constants
├── auth.ts                           # NextAuth v5 configuration
├── types.d.ts                        # TypeScript global declarations
├── instrumentation.ts                # Next.js instrumentation hook
└── drizzle.config.ts                 # Drizzle Kit configuration
```

---

## Design Patterns

### Server Components

React Server Components are the default. Client components are explicitly marked with `"use client"`. This approach:

- Reduces client-side JavaScript bundle size
- Enables direct database access in components without an API round-trip
- Improves initial page load performance via server-rendered HTML

### Server Actions

Business logic is implemented as server actions (`"use server"`) for:

- Type-safe, co-located data mutations
- Automatic `revalidatePath` / `revalidateTag` cache invalidation
- Progressive enhancement (forms work without JavaScript)

### Route Groups

Next.js route groups organize the application into three access tiers:

| Group | Path | Access |
|---|---|---|
| `(auth)` | `/sign-in`, `/sign-up` | Public; redirects authenticated users to `/` |
| `(root)` | `/`, `/search`, `/books/[id]`, `/my-profile` | Requires any authenticated session |
| `admin` | `/admin/**` | Requires `role === "ADMIN"` verified against the database |
| `(system)` | `/account`, `/setup` | Public pre-init; redirects to `/admin` post-init |

### System Initialization Guard

The `(system)` layout checks Redis (with a database fallback) on every request to determine whether the setup wizard has been completed. After initialization, all routes under `(system)` permanently redirect to `/admin`. This prevents re-running setup on a live system.

### Realtime Signal-and-Refresh Pattern

The admin dashboard uses a lightweight signal-and-refresh model rather than pushing full payloads over the wire:

1. A mutation completes (server action or API route)
2. The server publishes a refresh signal to Upstash Redis
3. Each app instance maintains **one shared Redis subscription** for all connected admin clients (per-instance fanout broker)
4. The broker fans the signal to connected admin SSE streams
5. Each admin client waits 3000 ms (batching window)
6. Each admin client fetches a fresh authenticated snapshot from `GET /api/admin/dashboard`
7. Dashboard widgets re-render from the updated snapshot

This keeps the realtime transport small and uses the authenticated API layer as the source of truth.

---

## Data Flow

### Standard User Action

```
User Action → Server Action → Database → revalidatePath/Tag → UI Re-render
```

1. User submits a form or clicks a button
2. Server action validates input and executes business logic
3. Drizzle ORM performs the query against Neon PostgreSQL
4. `revalidatePath()` or `revalidateTag()` invalidates affected cached routes
5. React re-renders the affected segments with fresh data

### Admin Borrow Approval (with Realtime)

```
Admin clicks Approve
  → Optimistic UI update (row shows BORROWED immediately)
  → PATCH /api/book/requests/:id/approve
  → assertLockOwnership() — verify distributed Redis lock
  → CTE SQL: update borrow_records + update books counters atomically
  → publishBookAvailabilityUpdate() → Redis pub/sub → /api/book/stream SSE
  → publishEvent("borrow_requests", UPDATE) → Redis → /api/admin/realtime/rows SSE
  → broadcastAdminDashboardUpdate() → Redis → /api/admin/dashboard/realtime SSE
  → All connected admin clients receive events and refresh relevant data
  → Public users on the book page see updated availableCopies without reload
```

### Realtime Admin Dashboard Flow

```
Any Mutation
  → Server publishes "dashboard:refresh" to Upstash Redis
  → Per-instance broker receives the event (one subscription per app instance)
  → Broker fans signal to all connected admin SSE clients on this instance
  → Each admin client waits 3000 ms
  → Each admin client fetches GET /api/admin/dashboard
  → Dashboard widgets re-render with updated snapshot
```

---

## Security Architecture

### Authentication Layer

- JWT-based sessions via NextAuth.js v5
- Credentials provider with bcrypt password hashing (cost factor 12)
- Session data stored in secure HTTP-only cookies
- `sessionVersion` embedded in JWT for stale-session detection

### Authorization Layer

- Role-based access control (`USER`, `ADMIN`)
- Admin layout re-verifies role from the database on every request (JWT role alone is insufficient)
- Server actions call `requireAdminActor()` before any privileged operation
- API routes return `401` for unauthenticated requests and `403` for insufficient role

### Realtime Security

- All admin SSE endpoints (`/api/admin/realtime/rows`, `/api/admin/dashboard/realtime`, `/api/admin/session/realtime`) require an authenticated `ADMIN` session
- Redis pub/sub channels carry lightweight signals — not raw data payloads
- Sensitive data is always fetched through authenticated API routes after receiving a signal
- Row locks require matching `adminId` and `token` for heartbeat and release — enforced by atomic Lua scripts in Redis

### Session Invalidation

When an admin is downgraded to `USER`, their `sessionVersion` is incremented in the database and a `RoleChangeEvent` is published to Redis. All active admin browser tabs receive a `session:invalidated` SSE event and are signed out immediately. See [Admin Session Invalidation](Admin_Session_Invalidation.md).

### Rate Limiting

Redis-backed rate limiting via Upstash with multiple tiers:

| Tier | Limit |
|---|---|
| Authentication endpoints | Token bucket: 3/10 min, burst 6 |
| Anonymous API requests | 60 req/min (sliding window) |
| Authenticated API requests | 300 req/min (sliding window) |
| Anonymous SSE connections | 2 concurrent streams per IP |
| Authenticated SSE connections | 3 concurrent streams per identity |
| Avatar uploads | 10/day |
| Receipt downloads | 5/min, 10/day |

---

## Caching Strategy

### Static Caching

- Static assets served via Next.js public directory and ImageKit CDN
- Server component output cached by the Next.js data cache

### Tag-Based Cache Invalidation

Two primary cache tags drive on-demand revalidation:

```typescript
export const CACHE_TAGS = {
  books: "books",
  users: "users",
};
```

- `revalidateTag("books")` — invalidated by any book create/update/delete or borrow status change
- `revalidateTag("users")` — invalidated by account approval/rejection, role change, avatar update, or dismiss action

### Cached Query Helpers

```typescript
// lib/performance/cache.ts
getLatestBooksCached()
getBookByIdCached(id)
getSimilarBooksCached(bookId)
getBorrowingEligibilityCached(bookId, userId)
searchBooksCached(query, filters)
```

---

## Error Handling

### Client-Side

- Toast notifications via Sonner
- Optimistic UI with rollback on API failure (admin tables, lock release)
- Form validation via React Hook Form + Zod

### Server-Side

- Structured JSON error responses (`{ error: string }`)
- `LockOwnershipError` class for type-safe lock conflict handling (returns `409 Conflict`)
- Best-effort realtime publishing — realtime events are wrapped in try/catch and never block primary operations
- Graceful degradation: if Redis is unavailable, rate limiting fails open and realtime stops working temporarily while core CRUD remains functional

---

## Scalability Considerations

- **Serverless Functions** — All API routes are stateless and scale automatically
- **Connection Pooling** — Neon's serverless HTTP driver manages PostgreSQL connections
- **CDN** — ImageKit for media; Vercel Edge Network for static assets
- **Per-Instance Broker** — Each app instance maintains one Redis subscription regardless of how many admins are connected to that instance, keeping Redis subscription counts proportional to deployed instances rather than connected users
- **Atomic SQL** — Counter updates and status transitions use single-statement CTEs compatible with the Neon HTTP driver

---

## Related Documentation

- [Database](Database.md) — Full schema, migrations, and query patterns
- [Authentication](Authentication.md) — NextAuth config, JWT callbacks, session flow
- [Authorization](Authorization.md) — RBAC, route protection, server action guards
- [Realtime System Guide](Realtime_System_Guide.md) — Complete realtime architecture overview
- [Admin Dashboard Realtime](Admin_Dashboard_Realtime.md) — Dashboard signal-and-refresh pattern
- [Admin Row Concurrency](Admin_Row_Concurrency.md) — Distributed locks and version conflict detection
- [Admin Session Invalidation](Admin_Session_Invalidation.md) — JWT staleness and forced sign-out
- [Borrowing System](Borrowing_System.md) — Reservation-first borrow lifecycle
- [Rate Limiting](Rate_Limiting.md) — Full rate limit configuration
- [Top Loader Navigation](Top_Loader_Navigation.md) — nprogress integration with App Router
- [Cache and Search Consistency](Cache_and_Search_Consistency.md) — Tag-based cache invalidation
