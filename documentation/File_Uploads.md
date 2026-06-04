# File Uploads

## Overview

BookWise handles three categories of file uploads: user profile avatars, university ID cards (during registration), and book cover images (admin only). All uploads go to ImageKit CDN via client-side direct upload using signed authentication parameters fetched from the server.

---

## Technology Stack

### Image Storage and CDN

- **ImageKit** — cloud image storage, transformation, and CDN delivery
- **ImageKit SDK** (`imagekitio-next` / `imagekit-javascript`) — client-side upload with progress tracking
- **Signed authentication** — short-lived `signature`, `expire`, and `token` fetched from `GET /api/auth/imagekit` before each upload

### Upload Components

- **`AvatarUploadControls`** — presentational layer: file picker trigger, crop modal, zoom slider, save/cancel buttons
- **`ImageCropper`** — smart wrapper that selects between setup mode and profile mode
- **`FileUpload`** — generic file upload component used for university ID cards and book cover images
- **`react-easy-crop`** — interactive crop UI for avatar images

### Validation

- **MIME type checking** — validated client-side before upload and re-validated after canvas crop
- **Filename sanitization** — safe filenames generated via `generateSafeFilename()` before upload

---

## ImageKit Configuration

```typescript
// lib/config.ts
export const config = {
  env: {
    imagekit: {
      publicKey:   process.env.IMAGEKIT_PUBLIC_KEY!,
      privateKey:  process.env.IMAGEKIT_PRIVATE_KEY!,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!,
    },
  },
};
```

### Authentication Endpoint

```typescript
// GET /api/auth/imagekit
export async function GET() {
  return NextResponse.json({
    ...imagekit.getAuthenticationParameters(), // { signature, expire, token }
    publicKey: config.env.imagekit.publicKey,
  });
}
```

This endpoint requires no authentication. Parameters are short-lived and validated server-side by ImageKit on upload. The `useAvatarUpload` hook calls this endpoint automatically before each upload attempt.

---

## Avatar Upload System

The avatar upload pipeline is managed entirely by `useAvatarUpload` (`lib/global/essentials/use-avatar-upload.ts`). The hook handles file selection, validation, cropping, ImageKit upload, and result delivery via an `onUploadComplete` callback.

### Full Upload Flow

```
1. User clicks the avatar trigger button
   → useAvatarUpload.openFilePicker() → hidden <input type="file"> click

2. User selects a file
   → handleImageChange()
   → MIME type validated against allowlist
   → File read as base64 data URL via FileReader
   → previewImage set, crop modal opens (isCropperOpen = true)

3. User adjusts the crop region and zoom
   → handleCropComplete() → croppedAreaPixels updated

4. User clicks "Save & Upload"
   → uploadCroppedImage()
   → getCroppedImg() — canvas crop to data URL
   → data URL fetched as Blob, MIME re-validated
   → generateSafeFilename() builds a safe filename
   → GET /api/auth/imagekit — fetch signed auth params
   → ImageKit SDK upload() with onProgress callback
   → onUploadComplete(result) called with { url, fileId, fileName }
   → uploadedImage state updated
```

### `useAvatarUpload` Options

```typescript
interface UseAvatarUploadOptions {
  initialAvatar?:     string | null;  // Pre-existing avatar URL to display
  fallbackAvatar?:    string;         // Shown when no avatar exists
  folder?:            string;         // ImageKit folder (default: "/users/avatars")
  fileNamePrefix?:    string;         // Filename prefix (default: "avatar")
  onUploadComplete?:  (result: AvatarUploadResult) => Promise<boolean | void> | boolean | void;
}
```

If `onUploadComplete` returns `false`, the hook does not update its internal `uploadedImage` state — the caller takes full control of whether the result is persisted.

### `currentAvatar` Resolution

The hook resolves the displayed avatar in this order:

```
uploadedImage → initialAvatar → fallbackAvatar
```

### Two Modes via `ImageCropper`

`ImageCropper` selects between two contexts:

| Mode | When | Behaviour |
|---|---|---|
| **Setup mode** | `avatarUpload` prop is provided | Uses the passed `useAvatarUpload` instance; no API call on complete |
| **Profile mode** | No `avatarUpload` prop | Creates its own instance internally; calls `PUT /api/avatar` on complete, updates NextAuth session, triggers `router.refresh()` |

This allows the same visual component to serve both the setup wizard (no session yet) and the live user profile page (session must be updated).

---

## University ID Card Upload

During registration (`/sign-up`), users upload a photo of their university ID card. This uses the generic `FileUpload` component:

```tsx
<FileUpload
  type="document"
  accept="image/*,.pdf"
  folder="university-cards"
  placeholder="Upload University ID Card"
  onUploadComplete={(response) => {
    setValue("universityCard", response.url);
  }}
/>
```

The uploaded URL is stored in the `universityCard` field on the `users` table. Admins view this image when reviewing account requests.

---

## Book Cover Upload (Admin)

Admins upload book cover images when creating or editing books through the `BookForm` component:

```tsx
<FileUpload
  type="image"
  accept="image/*"
  folder="book-covers"
  placeholder="Upload Book Cover"
  onUploadComplete={(response) => {
    setCoverUrl(response.url);
  }}
/>
```

The cover URL is stored in the `coverUrl` field on the `books` table. The `coverColor` hex is set separately by the admin via a color picker.

---

## Generic FileUpload Component

`components/FileUpload.tsx` is used for university cards and book covers. It handles its own state, validation, and upload internally:

```typescript
interface FileUploadProps {
  onUploadComplete?: (response: { url: string; fileId: string }) => void;
  onUploadError?:    (error: Error) => void;
  value?:            string;
  type?:             "image" | "document";
  accept?:           string;
  folder?:           string;
  placeholder?:      string;
}
```

### Upload Progress

```tsx
{isUploading && (
  <div className="upload-progress">
    <div className="progress-bar" style={{ width: `${progress}%` }} />
    <span>{Math.round(progress)}%</span>
  </div>
)}
```

---

## File Validation

### Allowed MIME Types

```typescript
const ALLOWED_MIME_TYPES = {
  image:    ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"],
  document: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
};
```

For avatar uploads, MIME type is checked twice: once when the file is selected, and again after the canvas crop produces a new Blob — this catches cases where the canvas serialization changes the MIME type.

### Filename Sanitization

```typescript
// lib/essentials/sanitizeFileExt.ts (or similar)
export const generateSafeFilename = (
  baseName: string,
  mimeType: string,
): string => {
  const extension = mimeType.split("/")[1];
  const sanitized = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${sanitized}.${extension}`;
};
```

---

## Rate Limiting

| Operation | Limit | Enforced by |
|---|---|---|
| Avatar upload (ImageKit) | 10 per day per user | `uploadAvatarRateLimit` |
| Avatar profile update (`PUT /api/avatar`) | 5 per day per user | `updateAvatarRateLimit` |

Both limits are defined in `lib/essentials/rateLimit.ts` using Upstash Redis fixed windows. The upload limit (`uploadAvatarRateLimit`) is checked in the avatar upload API flow; the update limit (`updateAvatarRateLimit`) is checked in `PUT /api/avatar` before the database write.

There are no documented rate limits for university card or book cover uploads beyond general API request limits.

---

## Error Handling

### ImageKit Upload Errors

```typescript
try {
  const result = await upload({ ... });
  await onUploadComplete(result);
} catch (error) {
  if (error instanceof ImageKitAbortError) {
    showErrorToast("Upload was cancelled");
  } else if (error instanceof ImageKitInvalidRequestError) {
    showErrorToast("Invalid file or request parameters");
  } else if (error instanceof ImageKitServerError) {
    showErrorToast("Server error during upload");
  } else if (error instanceof ImageKitUploadNetworkError) {
    showErrorToast("Network error during upload");
  } else {
    showErrorToast("Upload failed");
  }
}
```

### Validation Errors

Validation errors are displayed inline in the upload component before the upload is attempted:

```typescript
const error = validateFile(file, type);
if (error) {
  showErrorToast(error);
  return;
}
```

---

## Security Considerations

### Access Control

- **Avatar uploads** — authenticated users only; rate limited per user
- **Book cover uploads** — admin only (enforced by the admin layout and `requireAdminActor()` in `BookForm`)
- **University card uploads** — anonymous (during sign-up before a session exists); files land in a private ImageKit folder

### Storage

- All uploads go to ImageKit; no files are stored on the Next.js server or in the database
- Only the CDN URL and ImageKit file ID are persisted in the database
- When a user updates their avatar, the old file's `userAvatarFileId` can be used to delete the previous file from ImageKit, freeing storage

### Filename Safety

`generateSafeFilename()` strips all characters outside `[a-zA-Z0-9-_]` and appends the correct extension from the MIME type, preventing path traversal or injection via filenames.

---

## Performance Optimization

### ImageKit Transformations

ImageKit applies automatic transformations on delivery:

- Format conversion (WebP, AVIF) based on browser `Accept` header
- Responsive resizing via URL parameters
- CDN caching with long TTLs for hashed filenames

### Lazy Loading

Heavy upload components (`FileUpload`, `ImageCropper`, `LazyColorPicker`) are lazy-loaded via `lib/performance/bundle.tsx` to avoid including them in the initial bundle:

```typescript
// lib/performance/bundle.tsx
export const LazyFileUpload     = dynamic(() => import("@/components/FileUpload"));
export const LazyImageCropper   = dynamic(() => import("@/components/ImageCropper"));
export const LazyColorPicker    = dynamic(() => import("@/components/ColorPicker"));
```

---

## Related Files

- `components/AvatarUploadControls.tsx` — presentational crop modal and file picker
- `components/ImageCropper.tsx` — smart wrapper (setup mode vs. profile mode)
- `components/FileUpload.tsx` — generic file upload for ID cards and book covers
- `lib/global/essentials/use-avatar-upload.ts` — `useAvatarUpload` hook
- `lib/essentials/imageCrop.ts` — `getCroppedImg()` canvas crop utility
- `lib/essentials/sanitizeFileExt.ts` — `generateSafeFilename()`, MIME validation
- `lib/performance/bundle.tsx` — lazy-loaded component exports
- `app/api/auth/imagekit/route.ts` — signed upload auth endpoint
- `app/api/avatar/route.ts` — avatar CDN URL persistence endpoint
- `lib/essentials/rateLimit.ts` — `uploadAvatarRateLimit`, `updateAvatarRateLimit`
