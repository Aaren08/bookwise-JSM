# Authorization

## Overview

BookWise implements a role-based access control (RBAC) system with two primary roles: `USER` and `ADMIN`. Authorization is enforced at multiple levels — route layouts, server actions, and API route handlers — with database-level role re-verification for all sensitive admin operations.

---

## Roles

### USER Role

Standard library users with permissions to:

- Browse and search the book catalog
- Submit borrow requests (when account is `APPROVED`)
- View their own profile and borrow history
- Update their avatar
- Download their own borrow receipts
- Dismiss completed borrow records from their view
- Return their own borrowed books

### ADMIN Role

Library administrators with all USER permissions plus:

- Access the admin dashboard
- Manage books (create, update, delete)
- Manage users (approve, reject, delete, change roles)
- Manage borrow records (approve, reject, return, generate receipts)
- View all account requests and borrow records
- Access library statistics and realtime dashboard

---

## User Status

In addition to roles, users have a `status` field that gates borrowing eligibility:

```typescript
export const STATUS_ENUM = pgEnum("status", [
  "PENDING",   // Awaiting admin approval — cannot borrow
  "APPROVED",  // Full library access
  "REJECTED",  // Account rejected — cannot borrow
]);
```

### Status Flow

```
New Registration → PENDING
                      ↓
                Admin Review
                      ↓
           APPROVED ←——→ REJECTED
```

Only `APPROVED` users may submit borrow requests. Admins bypass this check when acting on behalf of a user.

---

## Route Protection

### Layout-Level Protection

#### User Routes (`app/(root)/layout.tsx`)

```typescript
const layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();

  if (!session) {
    return redirect("/sign-in");
  }

  after(async () => {
    // Update lastActivityDate for active session tracking
  });

  return (
    <main>
      <Header session={session} />
      {children}
    </main>
  );
};
```

#### Admin Routes (`app/admin/layout.tsx`)

Admin role is re-verified from the **database** on every request — the JWT role alone is not sufficient:

```typescript
const Layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const isAdmin = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
    .then((res) => res[0]?.role === "ADMIN");

  if (!isAdmin) redirect("/");

  return (
    <main>
      <Sidebar session={session} />
      <SessionGuard />   {/* Mounts session invalidation SSE hook */}
      {children}
    </main>
  );
};
```

`SessionGuard` holds an open SSE connection to `/api/admin/session/realtime`. If an admin's role is revoked while they have the dashboard open, they are signed out immediately without waiting for the JWT to expire. See [Admin Session Invalidation](Admin_Session_Invalidation.md).

#### Auth Routes (`app/(auth)/layout.tsx`)

Redirects already-authenticated users away from sign-in and sign-up pages:

```typescript
const Layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();

  if (session) {
    return redirect("/");
  }

  return <main>{children}</main>;
};
```

#### Setup Routes (`app/(system)/layout.tsx`)

Redirects to `/admin` if the system has already been initialized:

```typescript
const Layout = async ({ children }: { children: ReactNode }) => {
  await refreshSetupStateCache(); // checks Redis, falls back to DB

  const isInitialized = await getIsInitialized();
  if (isInitialized) redirect("/admin");

  return <main>{children}</main>;
};
```

---

## Server Action Authorization

### Admin Actor Guard

All admin server actions call `requireAdminActor()` before performing any work. This helper verifies the session exists and has `role === "ADMIN"`, returning a typed `AdminActor` object used downstream for lock ownership checks:

```typescript
// lib/global/auth/require-admin.ts
export const requireAdminActor = async (): Promise<AdminActor> => {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  return {
    id: session.user.id,
    name: session.user.name,
  };
};
```

### Lock Ownership Guard

Admin write actions that modify rows (approve, reject, delete, update) additionally call `assertLockOwnership()` to verify the calling admin holds the distributed Redis lock on that row. If the lock has expired or is held by another admin, a `LockOwnershipError` is thrown and the API returns `409 Conflict`:

```typescript
try {
  await assertLockOwnership(entity, entityId, session.user.id, body.lockToken);
} catch (error) {
  if (error instanceof LockOwnershipError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
} finally {
  // Always release the lock, even on failure
  await releaseLock(entity, entityId, session.user.id, body.lockToken)
    .catch((e) => console.error("releaseLock failed best-effort cleanup", e));
}
```

### User Actions

User-facing server actions verify ownership before returning data:

```typescript
// lib/actions/user.ts
export const getUserProfile = async (userId: string) => {
  const session = await auth();

  if (
    !session?.user?.id ||
    (session.user.id !== userId && session.user.role !== "ADMIN")
  ) {
    return { success: false, error: "Unauthorized" };
  }

  // Proceed with data fetch
};
```

---

## Protected Resources

### Books

| Action | USER | ADMIN |
|---|---|---|
| View catalog | ✅ | ✅ |
| View book details | ✅ | ✅ |
| Search books | ✅ | ✅ |
| Create book | ❌ | ✅ |
| Update book | ❌ | ✅ (lock + version required) |
| Delete book | ❌ | ✅ (lock + version required; blocked if active borrows exist) |

### Borrow Records

| Action | USER | ADMIN |
|---|---|---|
| Submit borrow request | ✅ (APPROVED only) | ✅ |
| View own records | ✅ | ✅ |
| View all records | ❌ | ✅ |
| Approve request | ❌ | ✅ (lock required) |
| Reject request | ❌ | ✅ (lock required) |
| Return book | ✅ (own record) | ✅ |
| Generate receipt | ❌ | ✅ |
| Download receipt | ✅ (own record) | ✅ |
| Dismiss own record | ✅ | ✅ |

### Users

| Action | USER | ADMIN |
|---|---|---|
| View own profile | ✅ | ✅ |
| View all users | ❌ | ✅ |
| Update own avatar | ✅ | ✅ |
| Approve accounts | ❌ | ✅ (lock + version required) |
| Reject accounts | ❌ | ✅ (lock + version required) |
| Delete users | ❌ | ✅ (lock + version required; blocked if active borrows exist) |
| Change user roles | ❌ | ✅ (lock + version required; last-admin guard on downgrade) |

### Admin Dashboard and Realtime

| Resource | USER | ADMIN |
|---|---|---|
| Dashboard statistics | ❌ | ✅ |
| Dashboard realtime SSE | ❌ | ✅ |
| Admin row realtime SSE | ❌ | ✅ |
| Row lock management | ❌ | ✅ |
| Session invalidation SSE | ❌ | ✅ |

---

## UI Authorization

### Conditional Rendering

Components hide admin-only controls from regular users:

```typescript
// Show receipt download only for completed borrows
{borrowStatus !== "PENDING" && (
  <ReceiptModal receipt={receipt} borrowStatus={borrowStatus} />
)}

// Show borrow button only to approved users with available capacity
{isEligible && (
  <BorrowBook bookId={book.id} userId={userId} />
)}
```

### Navigation Links

Admin sidebar links are only rendered inside the admin layout, which already enforces role verification:

```typescript
export const adminSideBarLinks = [
  { img: "/icons/admin/home.svg",    route: "/admin",                text: "Home" },
  { img: "/icons/admin/users.svg",   route: "/admin/users",          text: "All Users" },
  { img: "/icons/admin/book.svg",    route: "/admin/books",          text: "All Books" },
  { img: "/icons/admin/borrow.svg",  route: "/admin/borrow-records", text: "Borrow Records" },
  { img: "/icons/admin/request.svg", route: "/admin/account-requests", text: "Account Requests" },
];
```

---

## Borrowing Eligibility

Eligibility is checked before showing the borrow button and enforced again server-side when the request is submitted:

```typescript
type BorrowingEligibility = {
  isEligible: boolean;
  message: string;
};

// Server-side checks (in order):
// 1. User exists and is authenticated
// 2. User status is "APPROVED"
// 3. Book exists
// 4. availableCopies > 0 (no active request is at capacity)
// 5. User has no existing PENDING or BORROWED record for this book
```

Example eligibility messages:

- `"Book is not available at the moment. Please check back later."`
- `"You have already borrowed or requested this book."`
- `"You are not eligible to borrow this book. Please contact the library for more information."`

Eligibility results are cached via `getBorrowingEligibilityCached()` and revalidated after any borrow status change.

---

## Role Change Security

### Last-Admin Protection

The `updateUserRole` server action prevents the last admin from being demoted:

```typescript
// The WHERE clause aborts the update if this is the final admin
await db.update(users).set({ role: newRole }).where(
  and(
    eq(users.id, userId),
    // Only allow downgrade if at least one other admin exists
    sql`(
      role != 'ADMIN' OR
      (SELECT COUNT(*) FROM users WHERE role = 'ADMIN') > 1
    )`,
  ),
);
```

### Session Invalidation on Downgrade

When a user is downgraded from `ADMIN` to `USER`:

1. `sessionVersion` is incremented in the database
2. `publishRoleChangeEvent({ userId, newRole: "USER", sessionVersion })` publishes to Redis
3. The admin's open SSE connections receive `session:invalidated`
4. All active browser tabs call `signOut()` and redirect to `/sign-in`

Upgrading a user to `ADMIN` does **not** trigger session invalidation — the user gains access rather than losing it, so their existing session remains valid.

---

## API Route Authorization Pattern

All admin API routes follow this pattern:

```typescript
export async function PATCH(request: Request) {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Authorize role
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Validate request body
  const body = await request.json();

  // 4. Assert lock ownership (write operations only)
  try {
    await assertLockOwnership(entity, entityId, session.user.id, body.lockToken);
  } catch (error) {
    if (error instanceof LockOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // 5. Perform operation with version check
  try {
    const result = await updateWithVersionCheck({ ... });
    return NextResponse.json({ success: true, data: result });
  } finally {
    // 6. Release lock (best-effort)
    await releaseLock(entity, entityId, session.user.id, body.lockToken)
      .catch(console.error);
  }
}
```

---

## Best Practices

1. **Always verify on the server** — never trust client-side role checks alone.
2. **Database re-verification for admin routes** — re-fetch role from the database in admin layouts; JWT can be stale.
3. **Lock before write** — all admin row mutations require a valid distributed lock held by the calling admin.
4. **Version-check all updates** — use `updateWithVersionCheck()` to prevent lost-update conflicts between concurrent admins.
5. **Fail secure** — default to denying access when session or role verification fails.
6. **Consistent error messages** — return generic messages that do not reveal whether a resource exists vs. is forbidden.
7. **Layered protection** — route layout + server action + API route handler all independently enforce authorization; no single layer is relied upon alone.

---

## Related Files

- `app/(root)/layout.tsx` — user route protection
- `app/admin/layout.tsx` — admin route protection with DB role re-verification
- `app/(auth)/layout.tsx` — auth route redirect
- `app/(system)/layout.tsx` — setup route initialization guard
- `lib/global/auth/require-admin.ts` — `requireAdminActor()` helper
- `lib/admin/realtime/concurrency/rowConcurrency.ts` — `assertLockOwnership()`, `LockOwnershipError`
- `lib/actions/*.ts` — user server actions with auth checks
- `lib/admin/actions/*.ts` — admin server actions with role and lock verification
- `lib/admin/realtime/session/roleChangePublisher.ts` — session invalidation publisher
- `components/admin/SessionGuard.tsx` — realtime session invalidation hook mount
- `database/schema.ts` — role and status enum definitions
