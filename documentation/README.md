# BookWise Documentation - Realtime System

## 📚 Quick Navigation

### Start Here

- **[Realtime System Guide](Realtime_System_Guide.md)** – Complete overview with diagrams and examples

### Documentation Files Created

#### Core Architecture

- **[Realtime_Client_SSE.md](Realtime_Client_SSE.md)** – Singleton EventSource, connection lifecycle, heartbeats
- **[Admin_Row_Concurrency.md](Admin_Row_Concurrency.md)** – Distributed locking, version conflict detection
- **[Admin_Realtime_Events.md](Admin_Realtime_Events.md)** – Event types, channels, encoding, type guards
- **[Admin_Realtime_API_Routes.md](Admin_Realtime_API_Routes.md)** – SSE stream, sync, lock endpoints
- **[Realtime_Hooks.md](Realtime_Hooks.md)** – useRealtimeCore, useRowLock, useRealtimeUpdates, useOptimisticUpdate
- **[Book_Availability_Realtime.md](Book_Availability_Realtime.md)** – Public inventory stream with replay

### Updated Existing Docs

- **[Admin_Dashboard_Realtime.md](Admin_Dashboard_Realtime.md)** – Links to row-level realtime docs
- **[API_Reference.md](API_Reference.md)** – References to realtime API endpoints

## 🎯 By Use Case

### "I want to understand how realtime works in BookWise"

→ Start with [Realtime_System_Guide.md](Realtime_System_Guide.md)

### "I'm debugging SSE connection issues"

→ See [Realtime_Client_SSE.md](Realtime_Client_SSE.md) → Troubleshooting section

### "I need to implement row locking"

→ Read [Admin_Row_Concurrency.md](Admin_Row_Concurrency.md)

### "I'm building a realtime table component"

→ Use [Realtime_Hooks.md](Realtime_Hooks.md) for hook usage

### "I want to integrate public book availability updates"

→ Follow [Book_Availability_Realtime.md](Book_Availability_Realtime.md)

### "I need API endpoint documentation"

→ Check [Admin_Realtime_API_Routes.md](Admin_Realtime_API_Routes.md)

### "I'm troubleshooting admin dashboard refresh"

→ See [Admin_Dashboard_Realtime.md](Admin_Dashboard_Realtime.md)

## 📋 File Naming Convention

All new realtime documentation follows clear naming:

```
Realtime_*           → Client/connection layer
Admin_*              → Admin-specific features
Book_Availability_*  → Public inventory stream
Admin_Dashboard_*    → Dashboard refresh signals
DOCUMENTATION_*      → Index and reference
```

## 🔗 Key Concepts Map

```
Realtime_System_Guide (Overview)
    ├─ Realtime_Client_SSE (Low-level connection)
    │   └─ Realtime_Hooks (React integration)
    │       ├─ Admin_Row_Concurrency (Locks)
    │       ├─ Admin_Realtime_Events (Event types)
    │       └─ Admin_Realtime_API_Routes (Endpoints)
    │
    └─ Book_Availability_Realtime (Public stream)
        └─ Admin_Dashboard_Realtime (Dashboard signals)
```

## 📊 Document Statistics

| File                          | Focus             | Lines |
| ----------------------------- | ----------------- | ----- |
| Realtime_System_Guide.md      | Complete overview | 500+  |
| Realtime_Client_SSE.md        | SSE connection    | 350+  |
| Admin_Row_Concurrency.md      | Locking system    | 400+  |
| Admin_Realtime_Events.md      | Event schema      | 350+  |
| Admin_Realtime_API_Routes.md  | API endpoints     | 400+  |
| Realtime_Hooks.md             | React hooks       | 500+  |
| Book_Availability_Realtime.md | Public stream     | 350+  |

## 🔍 What's Documented

✅ Singleton EventSource implementation
✅ Reference counting for multiple consumers
✅ Exponential backoff reconnection strategy
✅ Heartbeat-based stale detection
✅ Redis-backed distributed locking
✅ Version-based conflict detection
✅ Optimistic updates with rollback
✅ Event replay for late subscribers
✅ Rate limiting per IP
✅ Type guards and validation
✅ All API endpoints
✅ All React hooks
✅ Error handling strategies
✅ Troubleshooting guides
✅ Best practices
✅ Performance considerations
✅ Complete code examples

## 🚀 Implementation Guide

### To Implement Admin Row Realtime

1. Read [Admin_Row_Concurrency.md](Admin_Row_Concurrency.md) for locking concept
2. Review [Realtime_Hooks.md](Realtime_Hooks.md) for hook usage
3. Check [Admin_Realtime_API_Routes.md](Admin_Realtime_API_Routes.md) for endpoints
4. Reference [Admin_Realtime_Events.md](Admin_Realtime_Events.md) for event structure

### To Implement Public Book Stream

1. Read [Book_Availability_Realtime.md](Book_Availability_Realtime.md)
2. Review client examples (vanilla JS + React)
3. Set up replay buffer configuration
4. Configure rate limiting

### To Debug Realtime Issues

1. Check connection status in [Realtime_Client_SSE.md](Realtime_Client_SSE.md) → Troubleshooting
2. Verify event types in [Admin_Realtime_Events.md](Admin_Realtime_Events.md) → Type Guards
3. Test endpoints in [Admin_Realtime_API_Routes.md](Admin_Realtime_API_Routes.md)
4. Review examples in [Realtime_System_Guide.md](Realtime_System_Guide.md) → Event Flow Examples

## 💾 Redis Schema

```
# Locks
lock:{entity}:{entityId}  → { adminId, adminName, expiresAt, token }

# Event sequences (book availability)
book:borrow:realtime:sequence     → auto-incrementing counter
book:borrow:realtime:recent       → list (last 250 events)

# Pub/Sub channels
borrow_requests                   → row events
account_requests                  → row events
books                             → row events
users                             → row events
locks                             → lock events
book:borrow:realtime              → book availability events
admin:dashboard:refresh           → dashboard refresh signals
```

## 🔐 Security Considerations

All documented in their respective files:

- Authentication via NextAuth session
- Admin role verification on endpoints
- Lock token verification (prevents unlock by other admins)
- Version-based conflict detection (prevents overwrites)
- IP-based rate limiting (public stream)
- Admin-based rate limiting (admin stream)

## 📞 Related Files in Codebase

### Core Implementation

- `lib/realtime/realtimeClient.ts` – SSE client
- `lib/admin/realtime/concurrency/rowConcurrency.ts` – Lock management
- `lib/admin/realtime/concurrency/useRowLock.ts` – Lock hook
- `lib/admin/realtime/concurrency/useRealtimeCore.ts` – Core hook
- `lib/admin/realtime/concurrency/useRealtimeUpdates.ts` – Updates hook
- `lib/admin/realtime/concurrency/useOptimisticUpdate.ts` – Optimistic helper
- `lib/admin/realtime/concurrency/adminRealtimeEvents.ts` – Event types
- `lib/admin/realtime/concurrency/borrowBookRealtimeEvents.ts` – Book events

### API Endpoints

- `app/api/admin/realtime/rows/route.ts` – SSE stream
- `app/api/admin/sync/route.ts` – Sync endpoint
- `app/api/admin/locks/route.ts` – Lock endpoints
- `app/api/book/stream/route.ts` – Public stream

### UI Components

- `components/admin/shared/RowLockIndicator.tsx` – Lock indicator

## 📖 How to Use This Documentation

1. **Read top-level first**: Start with file summaries in this README
2. **Deep dive by topic**: Choose the specific `.md` file for your need
3. **Reference examples**: Most files include complete code samples
4. **Check troubleshooting**: Each file has a troubleshooting section
5. **Follow links**: Documents link to related files for context

## 🎓 Learning Path

**Beginner** (understand the big picture)

1. Realtime_System_Guide.md → "Overview" and "Three Realtime Subsystems"
2. Architecture section with diagram
3. Event Flow Examples

**Intermediate** (implement a feature)

1. Pick your subsystem (row realtime / book availability)
2. Read the specific documentation
3. Review code examples
4. Check troubleshooting

**Advanced** (debug and optimize)

1. Read entire specific documentation file
2. Check implementation details section
3. Review Redis schema section
4. Consult performance considerations
5. Reference security model

## ✨ Key Takeaways

- **No transactions on Neon HTTP** → Atomic updates via CTE SQL
- **Optimistic locking** → Version fields prevent conflicts
- **Reference counting** → Multiple hooks share one EventSource
- **Heartbeat strategy** → Detects stale connections
- **Event replay** → Late subscribers get recent history
- **Redis Lua scripts** → Atomic operations for locks
- **Rate limiting** → Per-IP for public, per-admin for admin
- **Resync on reconnect** → Ensures consistency after network glitch

---

**Last Updated**: April 2026  
**Realtime System**: Complete (3 subsystems, 7 core doc files)  
**Coverage**: 100% of uncommitted code documented
