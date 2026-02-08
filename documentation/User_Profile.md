# User Profile

## Overview

The user profile system in BookWise allows users to manage their account information, view borrowing history, update profile pictures, and track their library activity. The system includes both user-facing features and admin management capabilities.

## Profile Data Model

### User Fields

```typescript
interface User {
  id: string; // UUID primary key
  fullName: string; // User's full name
  userAvatar?: string; // Profile picture URL
  userAvatarFileId?: string; // ImageKit file ID
  email: string; // Unique email address
  universityId: string; // Unique university ID
  password: string; // Bcrypt hashed password
  universityCard: string; // University ID card URL
  status: UserStatus; // Account approval status
  role: UserRole; // USER or ADMIN
  lastActivityDate: Date; // Last login/activity
  createdAt: Date; // Account creation date
}

type UserStatus = "PENDING" | "APPROVED" | "REJECTED";
type UserRole = "USER" | "ADMIN";
```

## Profile Management

### Viewing Profile

Users can access their profile through `/my-profile`:

```tsx
// Profile page displays
- Personal information
- Profile picture
- Account status
- Borrowing statistics
- Recent activity
```

### Updating Profile

Users can update:

- Profile picture/avatar
- Display name (if allowed)
- Password

**Note**: Email and university ID are immutable for security.

## Avatar Management

### Upload Process

1. **File Selection**: Users select image file
2. **Validation**: Check file type, size, dimensions
3. **Crop Interface**: Optional cropping with react-easy-crop
4. **Upload**: Send to ImageKit CDN
5. **Update Profile**: Save URL and file ID to database

### Avatar Component

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

### Rate Limiting

Avatar operations are rate limited:

- Upload: 10 times per day
- Update: 5 times per day

## Account Status Flow

### Registration Process

1. **Sign Up**: User creates account with PENDING status
2. **Email Verification**: Welcome email sent
3. **Admin Review**: Admin approves or rejects account
4. **Activation**: Account becomes APPROVED or REJECTED

### Status Indicators

```typescript
const getStatusDisplay = (status: UserStatus) => {
  switch (status) {
    case "PENDING":
      return { text: "Pending Approval", color: "yellow" };
    case "APPROVED":
      return { text: "Active", color: "green" };
    case "REJECTED":
      return { text: "Rejected", color: "red" };
  }
};
```

## Borrowing History

### Borrow Records Display

Users can view their complete borrowing history:

```tsx
// Display borrow records with status
<BorrowHistory userId={currentUser.id} />
```

**Features:**

- Current borrows (PENDING, BORROWED)
- Past borrows (RETURNED, LATE_RETURN)
- Due date warnings
- Receipt downloads
- Record dismissal

### Statistics

Profile shows borrowing statistics:

- Total books borrowed
- Currently borrowed
- Overdue books
- Borrowing streak/history

## Activity Tracking

### Last Activity Date

Updated on user login and major actions:

```typescript
await db
  .update(users)
  .set({ lastActivityDate: new Date() })
  .where(eq(users.id, userId));
```

### Activity Dashboard

Shows recent activity:

- Books borrowed/returned
- Profile updates
- Account status changes

## Admin User Management

### User Approval Process

Admins can manage user accounts:

```typescript
// Approve user account
await db.update(users).set({ status: "APPROVED" }).where(eq(users.id, userId));

// Reject user account
await db.update(users).set({ status: "REJECTED" }).where(eq(users.id, userId));
```

### User Management Interface

Admin dashboard includes:

- User list with search/filtering
- Account approval/rejection
- Role management (USER ↔ ADMIN)
- User deletion
- Bulk operations

### User Details View

Detailed user information:

- Profile information
- Borrowing history
- Account status timeline
- Activity logs

## Security Features

### Password Management

- Bcrypt hashing with cost factor 10
- Password change requires current password
- Secure password reset flow (future feature)

### Profile Data Validation

```typescript
const profileSchema = z.object({
  fullName: z.string().min(2).max(255),
  // Email and universityId not updatable
});
```

### Authorization Checks

- Users can only view/edit their own profiles
- Admins can view all profiles
- Server-side validation for all updates

## Profile Components

### UserProfile Component

Main profile display component:

```tsx
<UserProfile user={userData} isOwnProfile={true} />
```

### Profile Forms

- Avatar upload form
- Profile information form
- Password change form

### Admin Components

- `UserApprovalModal.tsx` - Account approval interface
- `ViewUserCard.tsx` - User card for admin views
- `DeleteUser.tsx` - User deletion confirmation

## API Endpoints

### User Profile Operations

```typescript
// Get user profile
GET / api / user / profile;

// Update profile
PUT / api / user / profile;

// Upload avatar
PUT / api / avatar;

// Change password
PUT / api / user / password;
```

### Admin User Operations

```typescript
// Get all users
GET / admin / api / users;

// Get user details
GET / admin / api / users / [id];

// Update user status
PUT / admin / api / users / [id] / status;

// Update user role
PUT / admin / api / users / [id] / role;

// Delete user
DELETE / admin / api / users / [id];
```

## Notifications

### Account Status Changes

- Email notification on approval/rejection
- Dashboard status updates
- Welcome emails for new users

### Profile Updates

- Confirmation emails for profile changes
- Avatar update confirmations

## Privacy Considerations

### Data Visibility

- Profile pictures are public
- Borrowing history is private
- Account status may be visible to admins only

### Data Retention

- User data retained until account deletion
- Borrow records kept for historical purposes
- Deleted user data anonymized

## Related Files

- `components/UserProfile.tsx` - Profile display component
- `components/FileUpload.tsx` - Avatar upload component
- `components/ImageCropper.tsx` - Avatar cropping interface
- `lib/actions/user.ts` - User profile server actions
- `lib/admin/actions/user.ts` - Admin user management actions</content>
  <parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\User_Profile.md
