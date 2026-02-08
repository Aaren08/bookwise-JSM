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

### Infrastructure
- **Upstash Redis** - Rate limiting and caching
- **Upstash QStash** - Workflow orchestration
- **ImageKit** - Image and video CDN
- **EmailJS** - Email service

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

## Data Flow

```
User Action → Server Action → Database → Revalidation → UI Update
```

1. **User Action**: Form submission or button click
2. **Server Action**: Validates input, executes business logic
3. **Database**: Drizzle ORM performs the query
4. **Revalidation**: `revalidatePath()` invalidates cached data
5. **UI Update**: React re-renders with fresh data

## Security Architecture

### Authentication Layer
- JWT-based sessions via NextAuth.js
- Credentials provider with bcrypt password hashing
- Session data stored in secure HTTP-only cookies

### Authorization Layer
- Role-based access control (USER, ADMIN)
- Server-side route protection in layouts
- Database-level role verification

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
