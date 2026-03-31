# Architecture

## Overview

BookWise is a modern full-stack library management system built with Next.js 16, featuring a robust architecture that separates concerns between the client and server while maintaining type safety throughout the application.

## Tech Stack

### Frontend

- **Next.js 16** - React framework with App Router
- **React 19** - UI library with Server Components
- **Tailwind CSS 4** - Utility-first CSS framework
- **Radix UI** - Accessible component primitives
- **Lucide React** - Icon library

### Backend

- **Next.js API Routes** - Serverless API endpoints
- **NextAuth.js v5** - Authentication
- **Drizzle ORM** - Type-safe database ORM
- **Neon Database** - Serverless PostgreSQL
- **ws** - WebSocket server for realtime admin dashboard signaling

### Infrastructure

- **Upstash Redis** - Rate limiting and caching
- **Upstash QStash** - Workflow orchestration
- **ImageKit** - Image and video CDN
- **EmailJS** - Email service
- **Node.js Instrumentation Hook** - Starts the singleton admin dashboard WebSocket server at boot

## Project Structure

```
bookwise/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Authentication routes (sign-in, sign-up)
│   │   ├── layout.tsx
│   │   ├── sign-in/
│   │   └── sign-up/
│   ├── (root)/                   # Main user-facing routes
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Home page
│   │   ├── my-profile/
│   │   ├── search/
│   │   └── books/[id]/
│   ├── admin/                    # Admin dashboard routes
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Dashboard home
│   │   ├── users/
│   │   ├── books/
│   │   ├── borrow-records/
│   │   └── account-requests/
│   ├── api/                      # API routes
│   │   ├── auth/
│   │   ├── avatar/
│   │   ├── receipt/
│   │   └── workflows/
│   ├── layout.tsx                # Root layout
│   ├── not-found.tsx
│   └── too-fast/                 # Rate limit exceeded page
├── components/                   # React components
│   ├── admin/                    # Admin-specific components
│   │   ├── context/
│   │   ├── dashboard/
│   │   ├── forms/
│   │   ├── shared/
│   │   └── tables/
│   ├── book/                     # Book-related components
│   └── ui/                       # Shadcn UI components
├── database/                     # Database configuration
│   ├── drizzle.ts               # Drizzle client
│   ├── redis.ts                 # Redis client
│   ├── schema.ts                # Database schema
│   └── seed.ts                  # Seed script
├── lib/                          # Utility libraries
│   ├── actions/                  # User server actions
│   ├── admin/                    # Admin server actions
│   │   └── actions/
│   ├── essentials/               # Utility functions
│   ├── config.ts                # Environment configuration
│   ├── emailjs.ts               # Email service
│   ├── validations.ts           # Zod schemas
│   ├── utils.ts                 # Helper functions
│   └── workflow.ts              # Upstash workflow client
├── migrations/                   # Drizzle migrations
├── public/                       # Static assets
├── constants/                    # App constants
├── auth.ts                       # NextAuth configuration
├── types.d.ts                   # TypeScript declarations
└── drizzle.config.ts            # Drizzle configuration
```

### Recent Realtime Additions

The architecture now also includes a small realtime dashboard layer built around these files:

- `instrumentation.ts` - Application startup hook that initializes the WebSocket server
- `lib/admin/realtime/dashboardSocketServer.ts` - Singleton `ws` server and broadcast helper
- `lib/admin/realtime/useAdminDashboardRealtime.ts` - Custom client hook for socket lifecycle and delayed refresh
- `components/admin/dashboard/AdminDashboardRealtime.tsx` - Client wrapper that hydrates and refreshes dashboard sections
- `app/api/admin/dashboard/route.ts` - Authenticated snapshot endpoint for admin dashboard data
- `documentation/Admin_Dashboard_Realtime.md` - Detailed implementation guide for the realtime system

## Design Patterns

### Server Components

The application leverages React Server Components by default, with client components explicitly marked using the `"use client"` directive. This approach:

- Reduces client-side JavaScript bundle
- Enables direct database access in components
- Improves initial page load performance

### Server Actions

Business logic is implemented as server actions (`"use server"`) for:

- Type-safe data mutations
- Automatic revalidation
- Progressive enhancement

### Route Groups

Next.js route groups organize the application:

- `(auth)` - Public authentication pages
- `(root)` - Protected user pages
- `admin` - Protected admin pages

### Layout Nesting

Each route group has its own layout for:

- Authentication checks
- Navigation components
- Shared UI elements

### Realtime Signal-and-Refresh Pattern

The admin dashboard now uses a signal-and-refresh realtime pattern:

- Mutations complete through server actions
- The server broadcasts a lightweight WebSocket refresh event
- Connected admin clients wait for a shared 3000ms delay window
- Clients fetch a fresh authenticated dashboard snapshot over HTTP
- Dashboard widgets re-render from the updated snapshot

This keeps the WebSocket layer small and uses the API/query layer as the source of truth.

## Data Flow

```
User Action → Server Action → Database → Revalidation → UI Update
```

1. **User Action**: Form submission or button click
2. **Server Action**: Validates input, executes business logic
3. **Database**: Drizzle ORM performs the query
4. **Revalidation**: `revalidatePath()` invalidates cached data
5. **UI Update**: React re-renders with fresh data

### Realtime Admin Dashboard Flow

```text
User/Admin Mutation
  -> Server Action
  -> Database Update
  -> WebSocket Broadcast
  -> Admin Client Receives Refresh Signal
  -> 3000ms Delay
  -> GET /api/admin/dashboard
  -> Fresh Snapshot
  -> Dashboard Re-render
```

This realtime flow currently powers:

- Dashboard statistics
- Borrow requests
- Account requests
- Recently added books

## Security Architecture

### Authentication Layer

- JWT-based sessions via NextAuth.js
- Credentials provider with bcrypt password hashing
- Session data stored in secure HTTP-only cookies

### Authorization Layer

- Role-based access control (USER, ADMIN)
- Server-side route protection in layouts
- Database-level role verification
- Admin-only snapshot access for realtime dashboard refreshes via `/api/admin/dashboard`

### WebSocket Security Model

- WebSocket messages carry refresh signals rather than raw dashboard payloads
- Sensitive admin dashboard data is fetched through an authenticated API route
- The database and snapshot API remain the source of truth

### Rate Limiting

- Redis-based rate limiting via Upstash
- Multiple rate limit tiers:
  - Authentication: 5 requests/minute
  - Avatar uploads: 10/day
  - Receipt downloads: 5/minute, 10/day

## Caching Strategy

### Static Caching

- Static assets via Next.js public directory
- Image optimization via ImageKit CDN

### Dynamic Caching

- Server components cached by default
- `revalidatePath()` for on-demand invalidation
- `revalidateTag()` for fine-grained cache control
- Realtime dashboard clients fetch a fresh authenticated snapshot after WebSocket refresh events

## Error Handling

### Client-Side

- Toast notifications via Sonner
- Form validation via React Hook Form + Zod
- Error boundaries for component-level errors

### Server-Side

- Structured error responses
- Logging for debugging
- Graceful degradation

## Scalability Considerations

- **Serverless Functions**: All API routes are stateless
- **Connection Pooling**: Neon's serverless driver handles connections
- **CDN**: ImageKit for media delivery
- **Edge-Ready**: Compatible with Vercel Edge Functions
- **Realtime Admin Updates**: One mutation can notify all connected admin dashboard sessions
- **Dedicated WebSocket Port**: The current realtime implementation uses a separate socket port that must be reachable in deployment
