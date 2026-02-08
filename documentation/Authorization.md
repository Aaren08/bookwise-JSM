# Authorization

## Overview

BookWise implements a role-based access control (RBAC) system with two primary roles: `USER` and `ADMIN`. Authorization is enforced at multiple levels including route protection, server actions, and UI rendering.

## Roles

### USER Role
Standard library users with permissions to:
- Browse and search books
- Request to borrow books
- View their profile and borrowed books
- Update their avatar
- View their borrow receipts
- Dismiss completed borrow records

### ADMIN Role
Library administrators with additional permissions to:
- Access the admin dashboard
- Manage all books (create, update, delete)
- Manage users (approve, reject, delete, change roles)
- Manage borrow records (update status, generate receipts, clear records)
- View all account requests
- Access library statistics

## User Status

In addition to roles, users have a status field:

```typescript
export const STATUS_ENUM = pgEnum("status", [
  "PENDING",   // Awaiting admin approval
  "APPROVED",  // Can use the library
  "REJECTED",  // Account rejected
]);
```

### Status Flow
```
New Registration → PENDING
                    ↓
            Admin Review
                    ↓
         APPROVED ← or → REJECTED
```

## Route Protection

### Layout-Level Protection

#### User Routes (`app/(root)/layout.tsx`)

```typescript
const layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();

  if (!session) {
    return redirect("/sign-in");
  }

  // Track user activity
  after(async () => {
    // Update last activity date
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

```typescript
const Layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  // Verify admin role from database
  const isAdmin = await db
    .select({ isAdmin: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
    .then((res) => res[0]?.isAdmin === "ADMIN");

  if (!isAdmin) redirect("/");

  return (
    <main>
      <Sidebar session={session} />
      {children}
    </main>
  );
};
```

#### Auth Routes (`app/(auth)/layout.tsx`)

Redirects authenticated users away from auth pages:

```typescript
const Layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();

  if (session) {
    return redirect("/");
  }

  return <main>{children}</main>;
};
```

## Server Action Authorization

### User Actions

Server actions verify ownership or admin access:

```typescript
// lib/actions/user.ts
export const getUserProfile = async (userId: string) => {
  const session = await auth();
  
  // Allow access if:
  // 1. User is accessing their own profile
  // 2. User is an admin
  if (
    !session?.user?.id ||
    (session.user.id !== userId && session.user.role !== "ADMIN")
  ) {
    return { success: false, error: "Unauthorized" };
  }

  // Proceed with data fetch
};
```

### Admin Actions

Admin-only actions verify role before execution:

```typescript
// lib/admin/actions/receipt.ts
export const generateReceipt = async (borrowRecordId: string) => {
  const session = await auth();
  
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  // Proceed with receipt generation
};
```

## Protected Resources

### Books
| Action | USER | ADMIN |
|--------|------|-------|
| View all books | ✓ | ✓ |
| View book details | ✓ | ✓ |
| Search books | ✓ | ✓ |
| Create book | ✗ | ✓ |
| Update book | ✗ | ✓ |
| Delete book | ✗ | ✓ |

### Borrow Records
| Action | USER | ADMIN |
|--------|------|-------|
| View own records | ✓ | ✓ |
| View all records | ✗ | ✓ |
| Request borrow | ✓ | ✓ |
| Update status | ✗ | ✓ |
| Generate receipt | ✗ | ✓ |
| Clear records | ✗ | ✓ |
| Dismiss own record | ✓ | ✓ |

### Users
| Action | USER | ADMIN |
|--------|------|-------|
| View own profile | ✓ | ✓ |
| View all users | ✗ | ✓ |
| Update own avatar | ✓ | ✓ |
| Approve accounts | ✗ | ✓ |
| Reject accounts | ✗ | ✓ |
| Delete users | ✗ | ✓ |
| Change user roles | ✗ | ✓ |

## UI Authorization

### Conditional Rendering

Components render based on user role:

```typescript
// Show receipt button only for admins or specific conditions
{!(borrowStatus === "PENDING") && (
  <button onClick={handleDownloadPDF}>
    <Download className="w-5 h-5" />
  </button>
)}
```

### Navigation Links

Admin sidebar links are only shown to admins:

```typescript
export const adminSideBarLinks = [
  { img: "/icons/admin/home.svg", route: "/admin", text: "Home" },
  { img: "/icons/admin/users.svg", route: "/admin/users", text: "All Users" },
  { img: "/icons/admin/book.svg", route: "/admin/books", text: "All Books" },
  // ...
];
```

## Borrowing Eligibility

The borrowing system checks multiple conditions:

```typescript
interface BorrowingEligibility {
  isEligible: boolean;
  message: string;
}

// Checks include:
// - User status is APPROVED
// - Book has available copies
// - User doesn't already have an active borrow for this book
```

## API Route Authorization

### Avatar Upload API

```typescript
// app/api/avatar/route.ts
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit check
  const { success } = await uploadAvatarRateLimit.limit(session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  // Proceed with upload
}
```

### Receipt Download API

```typescript
// app/api/receipt/download/route.ts
export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting per user + receipt combination
  const key = `receipt-download:user:${session.user.id}:receipt:${receiptId}`;
  // ...
}
```

## Best Practices

1. **Always verify on server** - Never trust client-side role checks alone
2. **Database verification** - Re-fetch role from database for sensitive operations
3. **Fail secure** - Default to denying access if verification fails
4. **Consistent error messages** - Don't leak information about why access was denied
5. **Layered protection** - Combine route protection with action-level checks

## Related Files

- `app/(root)/layout.tsx` - User route protection
- `app/admin/layout.tsx` - Admin route protection
- `app/(auth)/layout.tsx` - Auth route redirect
- `lib/actions/*.ts` - User server actions with auth checks
- `lib/admin/actions/*.ts` - Admin server actions with role verification
- `database/schema.ts` - Role and status enum definitions
