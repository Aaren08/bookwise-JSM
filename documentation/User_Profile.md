# User Profile

## Overview

The user profile system in BookWise allows users to manage their account information, view borrowing history, update their profile picture, and track library activity. Admins have additional capabilities to manage all user accounts through the admin dashboard.

---

## Profile Data Model

### User Fields

```typescript
interface User {
  id: string;                  // UUID primary key
  fullName: string;            // User's full name
  userAvatar?: string;         // Profile picture CDN URL (ImageKit)
  userAvatarFileId?: string;   // ImageKit file ID (used for deletion on update)
  email: string;               // Unique email address — immutable after registration
  universityId: string;        // Unique university ID — immutable after registration
  password: string;            // Bcrypt hashed password
  universityCard: string;      // University ID card image URL (ImageKit)
  status: UserStatus;          // Account approval status
  role: UserRole;              // USER or ADMIN
  lastActivityDate: Date;      // Updated on login and major actions
  createdAt: Date;             // Account creation timestamp
  version: number;             // Optimistic concurrency counter
  sessionVersion: number;      // Incremented on ADMIN → USER downgrade
}

type UserStatus = "PENDING" | "APPROVED" | "REJECTED";
type UserRole   = "USER" | "ADMIN";
```

### Immutable Fields

`email` and `universityId` cannot be changed after registration. They are used as unique identifiers and are not exposed in any profile update endpoint.

---

## Profile Management

### Viewing Profile

Users access their profile at `/my-profile`. The `UserProfile` component renders:

- Profile picture (with inline upload)
- Status badge
- Full name and email
- University information and student ID
- University card image

The institute name displayed in the university info section is read from `useSystemConfig()` (Zustand store), reflecting whatever was set during the setup wizard rather than a hardcoded value.

### Updating Profile

Users can currently update:

- **Profile picture / avatar** — via the `PUT /api/avatar` endpoint
- **Full name** — via `PUT /api/user/profile`

Email and university ID are not updatable. Password change is planned but not yet implemented.

---

## Avatar Management

### Upload Process

1. User clicks the avatar trigger → file picker opens
2. File is validated (MIME type, size)
3. Crop modal opens with `react-easy-crop`
4. Canvas-based crop produces a new image Blob
5. ImageKit signed auth params are fetched from `GET /api/auth/imagekit`
6. Image is uploaded to ImageKit CDN
7. `PUT /api/avatar` is called with the CDN URL and ImageKit file ID
8. The database record is updated; the NextAuth session is refreshed via `update()`
9. The new avatar renders without a full page reload

The `useAvatarUpload` hook in `lib/global/essentials/use-avatar-upload.ts` manages the full lifecycle. `ImageCropper` wraps it for the profile page context.

### Avatar API Endpoint

```typescript
// PUT /api/avatar
// Body: { avatar: string (CDN URL), fileId: string (ImageKit file ID) }

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await updateAvatarRateLimit.limit(session.user.id);
  if (!success) {
    return NextResponse.json(
      { error: "You can only update your avatar 5 times per day." },
      { status: 429 },
    );
  }

  const { avatar, fileId } = await request.json();

  const [updatedUser] = await db
    .update(users)
    .set({ userAvatar: avatar, userAvatarFileId: fileId })
    .where(eq(users.id, session.user.id))
    .returning({ status: users.status });

  // Refresh the NextAuth session so the new image is reflected immediately
  // (uses the update() function from useSession() on the client side)

  return NextResponse.json({ success: true, status: updatedUser?.status });
}
```

The response includes `status` so the client can route realtime events correctly after the update.

### Avatar Display

```tsx
<Avatar className="w-20 h-20">
  <AvatarImage src={user.userAvatar} alt={user.fullName} />
  <AvatarFallback>
    {user.fullName
      .split(" ")
      .map((n) => n[0])
      .join("")}
  </AvatarFallback>
</Avatar>
```

When no avatar is set, the component falls back to the user's initials.

### Rate Limiting

| Operation | Limit | Key |
|---|---|---|
| Avatar upload (ImageKit) | 10 per day | `uploadAvatarRateLimit` |
| Avatar profile update (`PUT /api/avatar`) | 5 per day | `updateAvatarRateLimit` |

Both limits are enforced via Upstash Redis in `lib/essentials/rateLimit.ts`.

---

## Account Status Flow

### Registration Process

1. User completes sign-up form → account created with `status: "PENDING"`
2. Welcome email sent via EmailJS
3. Admin reviews the user's details and university card image
4. Admin approves or rejects the account
5. Notification email sent to the user
6. `APPROVED` users gain full borrowing access; `REJECTED` users cannot borrow

### Status Badge

The `UserProfile` component renders one of three status states:

| Status | Icon | Label |
|---|---|---|
| `APPROVED` | `verified.svg` | Verified Student |
| `REJECTED` | `unapproved.svg` | Account Rejected |
| `PENDING` | `unverified.svg` | Unverified Student |

---

## Borrowing History

### Borrow Records Display

Users view their complete borrowing history on `/my-profile`. Records cover all statuses:

```typescript
type BorrowStatus =
  | "PENDING"      // Awaiting admin approval
  | "BORROWED"     // Currently checked out
  | "RETURNED"     // Returned on time
  | "LATE_RETURN"  // Returned after due date
  | "REJECTED";    // Rejected or expired
```

**Features:**

- Current borrows (`PENDING`, `BORROWED`) shown with due date and status
- Past borrows (`RETURNED`, `LATE_RETURN`, `REJECTED`) with return dates
- Receipt download button for completed borrows
- Dismiss button to hide completed records from view

### Dismissing Records

Users can dismiss completed records (`RETURNED`, `LATE_RETURN`, `REJECTED`) from their profile view:

```typescript
// PUT /api/borrow-records/[id]/dismiss
// Sets dismissed = 1 on the record after verifying ownership
```

The record is not deleted — it is soft-hidden by setting `dismissed = 1`. Historical data is preserved for admin and audit purposes.

### Borrowing Statistics

The profile page shows summary statistics:

- Total books borrowed (lifetime)
- Currently borrowed / pending
- Books returned late

---

## Activity Tracking

### Last Activity Date

Updated on user login and significant actions via the `after()` hook in the `(root)` layout:

```typescript
after(async () => {
  if (!session?.user?.id) return;
  await db
    .update(users)
    .set({ lastActivityDate: new Date() })
    .where(eq(users.id, session.user.id));
});
```

`after()` runs after the response is sent so it does not block page rendering.

---

## Admin User Management

### User Approval

Admins approve or reject accounts via server actions in `lib/admin/actions/user.ts`. Both operations require a distributed row lock and a version check:

```typescript
// Approve
await approveAccount({ userId, expectedVersion, lockToken });

// Reject
await rejectAccount({ userId, expectedVersion, lockToken });
```

After approval or rejection a notification email is sent fire-and-forget. See [Email Notifications](Email_Notifications.md).

### Role Management

Admins can promote users to `ADMIN` or demote admins to `USER` via `updateUserRole()`. Two safety mechanisms apply:

1. **Last-admin guard** — the SQL `WHERE` clause prevents the update if this is the last admin in the system.
2. **Session invalidation** — on `ADMIN → USER` downgrade, `sessionVersion` is incremented and a `RoleChangeEvent` is published to Redis. The demoted admin's active browser tabs receive a `session:invalidated` SSE event and are signed out immediately.

See [Admin Session Invalidation](Admin_Session_Invalidation.md) for the full flow.

### User Deletion

`deleteUser()` runs inside a transaction that:

1. Checks for active borrow records (`BORROWED` or `LATE_RETURN`) with a `FOR UPDATE` row lock — blocks deletion if any exist
2. Re-fetches the user row with a version check to prevent TOCTOU races
3. Deletes all borrow records for the user, then deletes the user row

Returns one of:
- `{ type: "active-borrows" }` — deletion blocked; user has active loans
- `{ type: "conflict" }` — version mismatch; row was modified since load
- `{ type: "success" }` — user and records deleted

### Admin User Interface Components

- `UserTable` — paginated list with search, sort, and optimistic status updates
- `UserApprovalModal` (or `ViewUserCard`) — detailed user view for account approval
- `DeleteUser` — deletion confirmation with lock acquire and best-effort lock release

---

## Security Features

### Profile Data Validation

```typescript
const profileUpdateSchema = z.object({
  fullName: z.string().min(2).max(255),
  // email and universityId are not accepted — they are immutable
});
```

### Authorization Checks

- Users can only view and edit their own profile
- Admins can view all profiles
- All profile update endpoints verify the session matches the target user ID (or is an admin)
- Password is never returned in any API response

---

## API Endpoints

### User-Facing

```typescript
// Get the signed-in user's profile
GET /api/user/profile

// Update profile details (e.g. fullName)
PUT /api/user/profile

// Update avatar (CDN URL + ImageKit file ID)
PUT /api/avatar

// Get the signed-in user's borrow history
GET /api/user/borrow-records

// Dismiss a completed borrow record from view
PUT /api/borrow-records/[id]/dismiss
```

> **Verification Required:** `GET /api/user/profile` and `PUT /api/user/profile` may be implemented as server actions rather than standalone route handlers. Check `lib/actions/user.ts` to confirm whether these are API routes or server actions before building a client integration.

### Admin-Facing (Server Actions)

Admin user operations are implemented as server actions in `lib/admin/actions/user.ts`, not as standalone REST endpoints:

```typescript
getApprovedUsers({ page, limit })
getApprovedUserById(userId)
getPendingUsers({ page, limit })
getPendingUserById(userId)
approveAccount({ userId, expectedVersion, lockToken })
rejectAccount({ userId, expectedVersion, lockToken })
deleteUser({ userId, expectedVersion, lockToken })
updateUserRole({ userId, role, expectedVersion, lockToken })
```

---

## Related Files

- `components/UserProfile.tsx` — profile display with inline avatar upload
- `components/ImageCropper.tsx` — smart avatar upload wrapper (setup vs. profile mode)
- `components/AvatarUploadControls.tsx` — presentational crop modal and file picker
- `lib/global/essentials/use-avatar-upload.ts` — `useAvatarUpload` hook (full upload lifecycle)
- `lib/actions/user.ts` — user-facing server actions
- `lib/admin/actions/user.ts` — admin user management server actions
- `app/api/avatar/route.ts` — avatar update API route
- `lib/essentials/rateLimit.ts` — `uploadAvatarRateLimit`, `updateAvatarRateLimit`
- `lib/store/system-config-store.ts` — `useSystemConfig()` for institute name display
- `lib/admin/realtime/session/roleChangePublisher.ts` — session invalidation on role downgrade
- `database/schema.ts` — `users` table definition
