# BookWise: Components, Actions & Client Systems that Powers the BookWise Application

## Overview

This document covers the component layer, server actions, and client-side state systems that power the BookWise application after setup is complete. It includes the avatar upload pipeline, the system config store, receipt generation, and the core admin user management actions.

---

## Components

### `AdminAuthForm`

**File:** `components/AdminAuthForm.tsx`

A self-contained form used during the setup flow to create the initial admin account. It handles all field state, validation, and submission internally, then delegates the result to a caller-supplied `onSubmit` callback.

**Fields:**

| Field      | Type         | Validation                             |
| ---------- | ------------ | -------------------------------------- |
| First name | `text`       | Required, non-empty                    |
| Last name  | `text`       | Required, non-empty                    |
| Email      | `email`      | Valid email format                     |
| Password   | `password`   | Minimum 8 characters                   |
| Avatar     | image upload | Must have a valid CDN URL after upload |

Validation runs on submit via a Zod schema (`adminAuthFormSchema`). All field errors are shown inline beneath their respective inputs with `aria-invalid` and `aria-describedby` for accessibility.

The avatar field is powered by the `useAvatarUpload` hook with `onUploadComplete` wired to update local state. The avatar URL is included in the Zod parse so the form cannot be submitted until an image has been successfully uploaded.

The password field has a show/hide toggle rendered as an accessible button with an `aria-label` that reflects the current visibility state.

The submit button is disabled while either the form is submitting (`isSubmitting`) or an avatar upload is in progress (`avatarUpload.isUploading`), preventing double-submission.

**Props:**

```ts
interface AdminAuthFormProps {
  onSubmit: (
    values: AdminAuthFormValues,
  ) =>
    | Promise<{ success: boolean; error?: string }>
    | { success: boolean; error?: string };
}
```

**`AdminAuthFormValues`:**

```ts
interface AdminAuthFormValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  avatarUrl: string;
  avatarFileId?: string;
}
```

---

### `ImageCropper`

**File:** `components/ImageCropper.tsx`

A smart wrapper that selects between two avatar upload modes based on context:

- **Setup mode** — when an external `avatarUpload` instance (from `useAvatarUpload`) is passed as a prop, the component renders `AvatarUploadControls` directly using that instance. No API call is made on upload complete; the result is handled by the caller.
- **Profile mode** — when no `avatarUpload` prop is provided, the component creates its own `useAvatarUpload` instance internally (via `ProfileImageCropper`) that is wired to `POST /api/avatar` on upload complete. It also updates the NextAuth session via `update()` and triggers `router.refresh()`.

This design lets the same visual component be used in both the setup wizard (where no session exists yet) and the user profile page (where a live session must be updated).

**Props:**

```ts
interface ImageCropperProps {
  userAvatar?: string | null; // Initial avatar URL (profile mode only)
  avatarUpload?: UseAvatarUploadReturn; // If provided, uses setup mode
  fallbackAvatar?: string;
  ariaLabel?: string;
  saveLabel?: string;
  triggerClassName?: string;
  avatarClassName?: string;
  hoverOverlayClassName?: string;
}
```

---

### `AvatarUploadControls`

**File:** `components/AvatarUploadControls.tsx`

The pure presentational layer of the avatar upload system. It renders:

1. A hidden `<input type="file" accept="image/*">` controlled via a ref
2. A circular avatar trigger button that shows the current avatar, a loading spinner during upload, and a hover overlay with a camera/edit icon
3. A full-screen crop modal (rendered via `createPortal` into `document.body`) containing a `react-easy-crop` canvas, a zoom slider, and Cancel/Save buttons

The component is entirely controlled — it receives a `UseAvatarUploadReturn` object and calls its methods directly. It holds no state of its own.

The crop modal is only mounted when `isCropperOpen` is `true` and a `previewImage` exists, and only on the client (`typeof document !== "undefined"` guard prevents SSR issues with `createPortal`).

**Props:**

```ts
interface AvatarUploadControlsProps {
  avatarUpload: UseAvatarUploadReturn;
  ariaLabel?: string;
  saveLabel?: string;
  triggerClassName?: string;
  avatarClassName?: string;
  hoverOverlayClassName?: string;
  fallbackAvatar?: string;
}
```

---

### `UserProfile`

**File:** `components/UserProfile.tsx`

Displays the authenticated user's profile card, including their avatar (with inline upload), status badge, name, email, university info, student ID, and university card image.

The avatar upload is wired directly (not via `ImageCropper`) using `useAvatarUpload` with `onUploadComplete` posting to `POST /api/avatar`, updating the session, and refreshing the page.

The status badge renders one of three states:

| Status     | Icon             | Text               |
| ---------- | ---------------- | ------------------ |
| `APPROVED` | `verified.svg`   | Verified Student   |
| `REJECTED` | `unapproved.svg` | Account Rejected   |
| `PENDING`  | `unverified.svg` | Unverified Student |

The institute name displayed in the university info section is pulled from the `useSystemConfig` hook (Zustand store), not hardcoded, so it reflects whatever was set during setup.

---

### `ReceiptModal`

**File:** `components/ReceiptModal.tsx`

A modal dialog that displays a formatted borrow receipt for a library transaction. It has two columns:

- **Left:** receipt header (logo, receipt ID, date issued), book details (title, author, genre, borrowed on, due date, duration)
- **Right:** terms and conditions, footer with website URL and support email

When `borrowStatus === "PENDING"`, all date fields are replaced with `"--/--/----"` placeholders and the download button is hidden. This prevents generating a misleading receipt before the borrow is confirmed.

The website URL and support email in the footer are read from `useSystemConfig()` (Zustand), so they always reflect the live system configuration.

The download button calls `downloadReceiptAsPDF(receipt)` and shows a toast on failure.

**Types:**

```ts
type Receipt = {
  receiptId: string;
  issuedAt: string;
  title: string;
  author: string;
  genre: string;
  borrowedOn: string;
  dueDate: string;
  duration: string;
  userName?: string;
  userEmail?: string;
};
```

---

### `SystemConfigProvider`

**File:** `components/SystemConfigProvider.tsx`

A thin client component that hydrates the Zustand system config store from a server-fetched `SystemConfig` object. It should be rendered near the root of the component tree, wrapping the application, so that all client components can access the system config without making their own DB calls.

It uses a `useEffect` to call `setSystemConfig` whenever the `config` prop changes, keeping the store in sync with any server-side revalidation.

```tsx
// Usage in a server layout:
const config = await getSystemConfig();
return <SystemConfigProvider config={config}>{children}</SystemConfigProvider>;
```

---

### `Sidebar` (Admin)

**File:** `components/admin/Sidebar.tsx`

The admin panel sidebar. Renders the BookWise logo, navigation links from `adminSideBarLinks` (via `AdminSidebarLink`), and a user info footer with the admin's avatar, name, email, and a sign-out button.

The avatar falls back to initials (via `getInitials`) when no image is available. A green dot is overlaid on the avatar as an online presence indicator. The sign-out button submits a form to the `handleSignOut` server action.

---

## Client Hooks

### `useAvatarUpload`

**File:** `lib/global/essentials/use-avatar-upload.ts`

The central hook managing the full avatar upload lifecycle. It is designed to be composed into any component that needs avatar selection, cropping, and upload.

**State managed:**

| State               | Type             | Description                            |
| ------------------- | ---------------- | -------------------------------------- |
| `selectedImage`     | `File \| null`   | The raw file selected from disk        |
| `previewImage`      | `string \| null` | Base64 data URL for the cropper        |
| `croppedImage`      | `string \| null` | Object URL of the cropped result       |
| `uploadedImage`     | `string \| null` | Final CDN URL after successful upload  |
| `crop`              | `Point`          | Current crop position `{ x, y }`       |
| `zoom`              | `number`         | Current zoom level (1–3)               |
| `croppedAreaPixels` | `Area \| null`   | Pixel coordinates of the crop region   |
| `isUploading`       | `boolean`        | True during the upload network request |
| `isCropperOpen`     | `boolean`        | True while the crop modal is visible   |

**`currentAvatar` resolution order:**

```
uploadedImage → initialAvatar → fallbackAvatar
```

**Upload flow:**

```
User clicks trigger
  → openFilePicker() → <input>.click()
  → handleImageChange() → MIME type check → FileReader → setPreviewImage + setIsCropperOpen(true)
  → User adjusts crop → handleCropComplete() → setCroppedAreaPixels()
  → User clicks "Save & Upload" → uploadCroppedImage()
    → getCroppedImg() (canvas crop to data URL)
    → fetch data URL → Blob → MIME re-check
    → generateSafeFilename()
    → authenticateImageKit() → GET /api/auth/imagekit
    → upload() (ImageKit SDK)
    → onUploadComplete(result)
    → setUploadedImage() + setCroppedImage()
```

**Options:**

```ts
interface UseAvatarUploadOptions {
  initialAvatar?: string | null; // Pre-existing avatar URL
  fallbackAvatar?: string; // Shown when no avatar exists
  folder?: string; // ImageKit upload folder (default: "/users/avatars")
  fileNamePrefix?: string; // Filename prefix (default: "avatar")
  onUploadComplete?: (
    result: AvatarUploadResult,
  ) => Promise<boolean | void> | boolean | void;
}
```

If `onUploadComplete` returns `false`, the hook will not update its internal `uploadedImage` state, giving the caller full control over whether to persist the result.

---

## Client State

### System Config Store

**File:** `lib/store/system-config-store.ts`

A Zustand store with `persist` middleware that caches the system configuration in `localStorage` under the key `"bookwise:system-config"`. This allows client components to access settings like `instituteName`, `websiteUrl`, `supportEmail`, and `borrowDurationDays` without a network round-trip.

**Store shape:**

```ts
interface SystemConfigState {
  systemConfig: SystemConfig;
  setSystemConfig: (config: Partial<SystemConfig>) => void;
  resetSystemConfig: () => void;
}
```

**Convenience selectors:**

```ts
// Access the full config object
const config = useSystemConfig();

// Access only the borrow duration
const days = useBorrowDuration();
```

The store is populated in two places: by `SystemConfigProvider` on initial page load (server-fetched values), and directly by the setup wizard on completion (to reflect new settings immediately without a refresh).

**Default values** (used before any config is loaded):

```ts
const DEFAULT_SYSTEM_CONFIG = {
  instituteName: "BookWise",
  websiteUrl: "",
  supportEmail: "",
  borrowDurationDays: 14,
};
```

---

## Server Actions

### Book Actions

**File:** `lib/actions/book.ts`

#### `borrowBook(params: BorrowBookParams)`

Creates a borrow request for a user. Designed to be race-condition safe without a serializable transaction by using atomic conditional SQL.

**Steps:**

1. **Duplicate guard** — checks for an existing `PENDING` or `BORROWED` record for the same user+book pair.
2. **Lazy expiry** — scans for stale `PENDING` records (older than 15 minutes) for this book and rejects them, reclaiming their `reservedCount` slots before checking availability.
3. **Atomic reservation** — performs a conditional `UPDATE` on `books` that only increments `reservedCount` if `reservedCount + borrowedCount < totalCopies`. If no row is updated, the book is unavailable.
4. **Borrow record insert** — creates a new record with `borrowStatus = 'PENDING'` and `reservedAt = NOW()`. The `dueDate` is calculated from the system config's `borrowDurationDays`.
5. **Cache revalidation** — revalidates `CACHE_TAGS.books` and `CACHE_TAGS.users`.
6. **Real-time broadcast** — fires `broadcastBookAvailabilityUpdate` and `broadcastAdminDashboardUpdate` (fire-and-forget), then publishes a `CREATE` event to the `borrow_requests` channel via `publishEvent`.

**Why `reservedCount` and not `borrowedCount`?** A borrow request starts as `PENDING` — the book hasn't physically left the library yet. `borrowedCount` is only incremented when the admin generates a receipt (i.e., marks it `BORROWED`). This two-count design accurately reflects physical availability.

#### `dismissBorrowRecord(borrowRecordId: string)`

Marks a borrow record as dismissed (sets `dismissed = 1`) after verifying the calling user owns the record or is an admin. Revalidates the users cache.

#### `getSimilarBooks(bookId: string)`

Fetches similar books via `getSimilarBooksCached`. Returns a JSON-serialized result.

---

### Receipt Actions

**File:** `lib/admin/actions/receipt.ts`

#### `generateReceipt(borrowRecordId: string)`

Admin-only action (guarded by `requireAdminActor()`). Transitions a `PENDING` borrow record to `BORROWED` and produces a formatted receipt object.

**Steps:**

1. Fetches the borrow record joined with book and user data.
2. Rejects if the record is already `RETURNED` or `LATE_RETURN`.
3. Updates the record: sets `borrowStatus = 'BORROWED'`, updates `borrowDate` to `NOW()`, and recalculates `dueDate` from the current `borrowDurationDays` setting.
4. Revalidates `/admin/borrow-records` and broadcasts a dashboard update.
5. Publishes an `UPDATE` event to the `borrow_requests` realtime channel.
6. Returns a `Receipt` object with formatted dates and a shortened `receiptId` (first 8 chars of the UUID, uppercased).

**Receipt format:**

```ts
{
  receiptId: string; // First 8 chars of UUID, uppercased
  issuedAt: string; // "DD/MM/YYYY, hh:mm A"
  title: string;
  author: string;
  genre: string;
  borrowedOn: string; // "DD/MM/YYYY"
  dueDate: string; // "DD/MM/YYYY"
  duration: string; // e.g., "14 Days"
  userName: string;
  userEmail: string;
}
```

#### `getReceipt(borrowRecordId: string)`

Fetches a receipt for any borrow record (no admin guard). Computes the `duration` dynamically from the difference between `dueDate` and `borrowDate` stored in the DB, rather than reading from system config. This ensures receipts for historical borrows reflect the duration at the time of borrowing, not the current setting.

---

### User Management Actions

**File:** `lib/admin/actions/user.ts`

All write actions require `requireAdminActor()` and use optimistic concurrency via `expectedVersion` to prevent lost-update conflicts.

#### `getApprovedUsers({ page, limit })` / `getApprovedUserById(userId)`

Fetches approved users with a left join on `borrowRecords` (status `BORROWED`) to include a `booksBorrowed` count. Paginated with `limit`/`offset`.

#### `getPendingUsers({ page, limit })` / `getPendingUserById(userId)`

Fetches users with `status = 'PENDING'`. No borrow record join needed.

#### `approveAccount({ userId, expectedVersion, lockToken })`

1. Acquires and asserts a distributed lock via `assertLockOwnership`.
2. Verifies the user is still pending.
3. Updates `status = 'APPROVED'` via `updateWithVersionCheck` (optimistic lock).
4. Revalidates paths and broadcasts.
5. Publishes a `DELETE` event to `account_requests` and a `CREATE` event to `users`.
6. Releases the lock in a `finally` block.

#### `rejectAccount({ userId, expectedVersion, lockToken })`

Same flow as `approveAccount` but sets `status = 'REJECTED'`. Publishes only a `DELETE` to `account_requests` (rejected users don't appear in the users list).

#### `deleteUser({ userId, expectedVersion, lockToken })`

Runs inside a transaction:

1. Checks for active borrow records (`BORROWED` or `LATE_RETURN`) with a `FOR UPDATE` lock. Blocks deletion if any exist.
2. Re-fetches the user row with a version check and `FOR UPDATE` lock (TOCTOU protection).
3. Deletes all borrow records for the user, then deletes the user.
4. Returns `{ type: "active-borrows" }`, `{ type: "conflict" }`, or `{ type: "success" }` to allow the caller to surface the right error message.

#### `updateUserRole({ userId, role, expectedVersion, lockToken })`

Updates a user's role with two notable behaviors:

- **Last-admin protection:** when downgrading to `USER`, the `WHERE` clause includes a subquery that aborts the update if this is the last admin: `(role != 'ADMIN' OR (SELECT count(*) FROM users WHERE role = 'ADMIN') > 1)`.
- **Selective session invalidation:** `sessionVersion` is only incremented on an `ADMIN → USER` downgrade. Upgrading a user to admin doesn't require invalidation since the user gains access rather than losing it.

After a downgrade, `publishRoleChangeEvent` is called to push a server-sent event that forces the demoted user's session to refresh on their active client.

---

## Image Utilities

### `getCroppedImg`

**File:** `lib/essentials/imageCrop.ts`

A canvas-based utility that crops an image to the pixel coordinates provided by `react-easy-crop`. It:

1. Loads the image via `createImage` (sets `crossOrigin = "anonymous"` to avoid CORS issues).
2. Creates an off-screen canvas sized to the crop region.
3. Uses `ctx.drawImage` to extract the crop.
4. Returns an object URL via `canvas.toBlob` (JPEG format).

Returns `null` if the canvas context is unavailable (e.g., in a non-browser environment).

---

## File Map

```
components/
  AdminAuthForm.tsx          # Admin account creation form (setup step 1)
  AvatarUploadControls.tsx   # Presentational avatar picker + crop modal
  ImageCropper.tsx           # Smart wrapper: setup mode vs. profile mode
  ReceiptModal.tsx           # Borrow receipt display modal with PDF download
  SystemConfigProvider.tsx   # Hydrates Zustand store from server config
  UserProfile.tsx            # User profile card with inline avatar upload
  admin/
    Sidebar.tsx              # Admin panel navigation sidebar

lib/
  actions/
    book.ts                  # borrowBook, dismissBorrowRecord, getSimilarBooks
  admin/actions/
    receipt.ts               # generateReceipt, getReceipt
    user.ts                  # CRUD + role management for users
  essentials/
    imageCrop.ts             # Canvas crop utility
  global/
    essentials/
      use-avatar-upload.ts   # Core avatar upload hook
      system-config.ts       # SystemConfig type, defaults, formatters
    system-config.ts         # getSystemConfig, getBorrowDurationDays (server)
  store/
    system-config-store.ts   # Zustand store with localStorage persistence
```
