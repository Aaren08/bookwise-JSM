# BookWise Documentation - Realtime System

## 📚 Quick Navigation

### Start Here

- **[Realtime System Guide](Realtime_System_Guide.md)** – Complete overview with diagrams and examples

### Core Implementation Updates (Latest)

#### Error Handling & Resilience

- **Lock Ownership Errors** – New `LockOwnershipError` class for type-safe lock conflicts (returns 409 Conflict)
- **Best-Effort Publishing** – All realtime events wrapped in try-catch to prevent operation failures
- **Graceful Lock Cleanup** – Finally blocks ensure locks are always released, with fallback error logging

#### API Route Improvements

- **Approve/Reject/Return Endpoints** – Now validate lock ownership early, return 409 on conflicts
- **Avatar Upload** – Returns updated user status for proper realtime event routing
- **Cron Job** – Batch-fetches full records with version increments for efficient realtime broadcasts

#### Component & Hook Updates

- **useRealtimeUpdates** – Now requires `items` prop for proper state tracking
- **Table Components** – Pass filtered items to hooks to avoid unnecessary lock checks
- **RowLockIndicator** – Enhanced with ARIA attributes for accessibility
- **BookForm** – Type-safe admin actor passing with early session validation
- **DeleteBook** – Try-catch error handling with guaranteed lock release

#### Auth & Account Management

- **Signup Flow** – Non-blocking fire-and-forget patterns for realtime updates and workflows
- **Account Request Publishing** – IIFE pattern for independent async operations

### Documentation Files Created

#### Core Architecture

- **[Realtime_Client_SSE.md](Realtime_Client_SSE.md)** – Singleton EventSource, connection lifecycle, heartbeats
- **[Admin_Row_Concurrency.md](Admin_Row_Concurrency.md)** – Distributed locking, version conflict detection
- **[Admin_Realtime_Events.md](Admin_Realtime_Events.md)** – Event types, channels, encoding, type guards
- **[Admin_Realtime_API_Routes.md](Admin_Realtime_API_Routes.md)** – SSE stream, sync, lock endpoints
- **[Realtime_Hooks.md](Realtime_Hooks.md)** – useRealtimeCore, useRowLock, useRealtimeUpdates, useOptimisticUpdate
- **[Book_Availability_Realtime.md](Book_Availability_Realtime.md)** – Public inventory stream with replay

### Updated Existing Docs

- **[Admin_Dashboard.md](Admin_Dashboard.md)** – New UI improvements, lock handling, navigation patterns
- **[Admin_Dashboard_Optimization.md](Admin_Dashboard_Optimization.md)** – Cron job enhancements, batch operations
- **[Admin_Dashboard_Realtime.md](Admin_Dashboard_Realtime.md)** – Links to row-level realtime docs
- **[Authentication.md](Authentication.md)** – Signup flow improvements, async patterns
- **[Borrowing_System.md](Borrowing_System.md)** – Atomic operations with realtime events
- **[User_Profile.md](User_Profile.md)** – Avatar update error handling, rate limits
- **[API_Reference.md](API_Reference.md)** – References to realtime API endpoints

## 🔄 Recent Changes Summary

### Breaking Changes

- `useRealtimeUpdates` now requires `items` prop (was optional)

### Non-Breaking Improvements

- Lock conflict handling returns proper HTTP 409 status
- Realtime publishing never fails user operations
- All API responses now capture and return necessary fields for realtime events
- Improved type safety with `LockOwnershipError` class
- Enhanced accessibility in UI components

### Database Migration

- `0006_admin_realtime_concurrency.sql` upgraded with:
  - Batched backfill to avoid locking entire tables
  - Explicit Phase 1/2/3 approach for safety
  - Applied to `borrow_records`, `books`, and `users` tables

## 🎯 By Use Case

### "I want to understand how realtime works in BookWise"

→ Start with [Realtime_System_Guide.md](Realtime_System_Guide.md)

### "I'm debugging SSE connection issues"

→ See [Realtime_Client_SSE.md](Realtime_Client_SSE.md) → Troubleshooting section

### "I need to implement row locking"

→ Read [Admin_Row_Concurrency.md](Admin_Row_Concurrency.md) → Now includes error handling patterns

### "I'm building a realtime table component"

→ Use [Realtime_Hooks.md](Realtime_Hooks.md) → Updated with `items` prop requirements

### "I want to integrate public book availability updates"

→ Follow [Book_Availability_Realtime.md](Book_Availability_Realtime.md)

### "I need API endpoint documentation"

→ Check [Admin_Realtime_API_Routes.md](Admin_Realtime_API_Routes.md) → Now documents 409 Conflict responses

### "I'm troubleshooting admin dashboard refresh"

→ See [Admin_Dashboard_Realtime.md](Admin_Dashboard_Realtime.md)

### "I'm implementing user-facing features"

→ See [Authentication.md](Authentication.md), [User_Profile.md](User_Profile.md), [Borrowing_System.md](Borrowing_System.md)

## 📋 File Naming Convention

All new realtime documentation follows clear naming:

```
Realtime_*           → Client/connection layer
Admin_*              → Admin-specific features
Book_Availability_*  → Public inventory stream
Authentication_*     → Auth & account management
User_*              → User-facing features
DOCUMENTATION_*     → Index and reference
```

## 🔗 Key Concepts Map

```
Realtime_System_Guide (Overview)
    ├─ Realtime_Client_SSE (Low-level connection)
    ├─ Admin_Row_Concurrency (Locking + error handling)
    ├─ Admin_Realtime_Events (Event schema)
    ├─ Admin_Realtime_API_Routes (API endpoints)
    ├─ Realtime_Hooks (React hooks)
    ├─ Book_Availability_Realtime (Public stream)
    └─ Admin_Dashboard (UI patterns)
```

## 📊 Document Statistics

| File                          | Focus             | Status      |
| ----------------------------- | ----------------- | ----------- |
| Realtime_System_Guide.md      | Complete overview | Complete    |
| Realtime_Client_SSE.md        | SSE connection    | Complete    |
| Admin_Row_Concurrency.md      | Locking system    | **Updated** |
| Admin_Realtime_Events.md      | Event schema      | Complete    |
| Admin_Realtime_API_Routes.md  | API endpoints     | **Updated** |
| Realtime_Hooks.md             | React hooks       | **Updated** |
| Book_Availability_Realtime.md | Public stream     | **Updated** |
| Admin_Dashboard.md            | UI patterns       | **Updated** |
| Admin_Dashboard_Optimization  | Cron jobs         | **Updated** |
| Authentication.md             | Auth flow         | **Updated** |
| Borrowing_System.md           | Borrow logic      | **Updated** |
| User_Profile.md               | User avatar       | **Updated** |

## 🔍 What's Documented

✅ Singleton EventSource implementation
✅ Reference counting for multiple consumers
✅ Exponential backoff reconnection strategy
✅ Heartbeat-based stale detection
✅ **Lock ownership errors with type safety**
✅ **Best-effort realtime event publishing**
✅ **Graceful lock cleanup and error recovery**
✅ Redis-backed distributed locking
✅ Version-based conflict detection
✅ Optimistic updates with rollback
✅ Event replay for late subscribers
✅ Rate limiting per IP
✅ Type guards and validation
✅ All API endpoints
✅ All React hooks
✅ Error handling strategies (NEW)
✅ Troubleshooting guides
✅ Best practices
✅ Performance considerations
✅ Complete code examples
✅ Accessibility improvements (NEW)

## 🚀 Implementation Guide

### To Implement Admin Row Realtime

1. Read [Admin_Row_Concurrency.md](Admin_Row_Concurrency.md) for locking concept + error handling
2. Review [Realtime_Hooks.md](Realtime_Hooks.md) for hook usage with `items` prop
3. Check [Admin_Realtime_API_Routes.md](Admin_Realtime_API_Routes.md) for endpoints and error codes
4. Review [Admin_Dashboard.md](Admin_Dashboard.md) for UI component patterns
5. Implement with error handling from [Authentication.md](Authentication.md), [Borrowing_System.md](Borrowing_System.md)

## 🔄 Migration Notes

### v2.0 - Lock Error Handling

**Before**:

```typescript
await assertLockOwnership(...);  // Throws generic Error
```

**After**:

```typescript
try {
  await assertLockOwnership(...);
} catch (error) {
  if (error instanceof LockOwnershipError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}
```

### v2.0 - useRealtimeUpdates items prop

**Before** (optional):

```typescript
useRealtimeUpdates({
  entity: "books",
  setItems: setSortedData,
  // ...
});
```

**After** (required):

```typescript
useRealtimeUpdates({
  entity: "books",
  items: sortedData, // NOW REQUIRED
  setItems: setSortedData,
  // ...
});
```

### v2.0 - Avatar Update Response

**Before**:

```typescript
await db.update(users).set({...});  // Returned void
```

**After**:

```typescript
const [updatedUser] = await db
  .update(users)
  .set({...})
  .returning({ status: users.status });  // Capture status for routing
```

