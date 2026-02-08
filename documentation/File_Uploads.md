# File Uploads

## Overview

BookWise implements a robust file upload system for handling user avatars, university ID cards, and book cover images. The system uses ImageKit for cloud storage and optimization, with client-side upload capabilities and comprehensive security measures.

## Technology Stack

### Image Storage & CDN

- **ImageKit** - Cloud image storage and optimization
- **ImageKit SDK** - Client-side upload functionality
- **CDN Delivery** - Global content delivery

### Upload Components

- **FileUpload** - Generic file upload component
- **ImageCropper** - Avatar cropping interface
- **react-easy-crop** - Image cropping library

### Security & Validation

- **File Type Validation** - MIME type checking
- **Size Limits** - File size restrictions
- **Filename Sanitization** - Safe filename generation

## Upload Configuration

### ImageKit Setup

```typescript
// lib/config.ts
export const imagekitConfig = {
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!,
};
```

### Authentication Endpoint

```typescript
// app/api/auth/imagekit/route.ts
export async function GET() {
  return NextResponse.json({
    ...imagekit.getAuthenticationParameters(),
    publicKey: config.env.imagekit.publicKey,
  });
}
```

## File Upload Component

### Core Upload Logic

```tsx
// components/FileUpload.tsx
const FileUpload = ({
  onUploadComplete,
  onUploadError,
  value,
  type = "image",
  accept,
  folder = "",
}: FileUploadProps) => {
  // State management
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Authentication
  const authenticator = async () => {
    const response = await fetch("/api/auth/imagekit");
    const data = await response.json();
    return {
      signature: data.signature,
      expire: data.expire,
      token: data.token,
      publicKey: data.publicKey,
    };
  };

  // Upload handler
  const handleUpload = async (file: File) => {
    const authParams = await authenticator();
    const safeFileName = generateSafeFilename(
      `upload-${Date.now()}`,
      file.type,
    );

    const uploadResponse = await upload({
      expire: authParams.expire,
      token: authParams.token,
      signature: authParams.signature,
      publicKey: authParams.publicKey,
      file,
      fileName: safeFileName,
      folder,
      onProgress: (event) => {
        setProgress((event.loaded / event.total) * 100);
      },
    });

    onUploadComplete?.(uploadResponse);
  };
};
```

## File Types and Validation

### Supported File Types

```typescript
const ALLOWED_MIME_TYPES = {
  image: ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"],
  document: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
};
```

### File Size Limits

```typescript
const FILE_SIZE_LIMITS = {
  avatar: 5 * 1024 * 1024, // 5MB
  universityCard: 10 * 1024 * 1024, // 10MB
  bookCover: 15 * 1024 * 1024, // 15MB
};
```

### Validation Functions

```typescript
// lib/essentials/sanitizeFileExt.ts
export const isAllowedMimeType = (
  file: File,
  type: "image" | "document",
): boolean => {
  return ALLOWED_MIME_TYPES[type].includes(file.type);
};

export const isValidFileSize = (file: File, maxSize: number): boolean => {
  return file.size <= maxSize;
};

export const generateSafeFilename = (
  baseName: string,
  mimeType: string,
): string => {
  const extension = mimeType.split("/")[1];
  const sanitized = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${sanitized}.${extension}`;
};
```

## Avatar Upload System

### Profile Picture Upload

Users can upload and crop profile pictures:

```tsx
// Avatar upload flow
1. File selection
2. Validation (type, size)
3. Optional cropping
4. Upload to ImageKit
5. Update user profile
6. Display new avatar
```

### Image Cropping

```tsx
// components/ImageCropper.tsx
const ImageCropper = ({
  imageSrc,
  onCropComplete,
  aspect = 1,
}: ImageCropperProps) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const onCropAreaChange = (croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleCropComplete = () => {
    // Generate cropped image blob
    const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels);
    onCropComplete(croppedImage);
  };
};
```

### Avatar Update API

```typescript
// app/api/avatar/route.ts
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting
  const { success } = await updateAvatarRateLimit.limit(session.user.id);
  if (!success) {
    return NextResponse.json(
      {
        error: "You can only update your avatar 5 times per day.",
      },
      { status: 429 },
    );
  }

  const { avatar, fileId } = await request.json();

  // Update user profile
  await db
    .update(users)
    .set({
      userAvatar: avatar,
      userAvatarFileId: fileId,
    })
    .where(eq(users.id, session.user.id));

  // Update session
  await auth.api.updateSession({
    user: {
      image: avatar,
    },
  });

  return NextResponse.json({ success: true });
}
```

## University Card Upload

### Registration Upload

During sign-up, users upload university ID cards:

```tsx
// components/AuthForm.tsx - Sign up form
const universityCardUpload = (
  <FileUpload
    type="document"
    accept="image/*,.pdf"
    folder="university-cards"
    placeholder="Upload University ID Card"
    onUploadComplete={(response) => {
      setValue("universityCard", response.url);
    }}
  />
);
```

### Admin Verification

Admins review uploaded university cards during account approval:

```tsx
// Admin user approval modal
<Image
  src={user.universityCard}
  alt="University Card"
  width={300}
  height={200}
  className="rounded-lg"
/>
```

## Book Cover Upload

### Admin Book Management

Admins can upload book covers when adding/editing books:

```tsx
// Admin book form
<FileUpload
  type="image"
  accept="image/*"
  folder="book-covers"
  placeholder="Upload Book Cover"
  onUploadComplete={(response) => {
    setCoverUrl(response.url);
    setCoverColor(generateColorFromImage(response.url));
  }}
/>
```

### Cover Color Generation

Automatically generate accent colors from uploaded covers:

```typescript
const generateColorFromImage = (imageUrl: string): string => {
  // Extract dominant color from image
  // Return hex color code
};
```

## Error Handling

### Upload Errors

```typescript
const handleUploadError = (error: ImageKitError) => {
  if (error instanceof ImageKitAbortError) {
    showErrorToast("Upload was cancelled");
  } else if (error instanceof ImageKitInvalidRequestError) {
    showErrorToast("Invalid file or request parameters");
  } else if (error instanceof ImageKitServerError) {
    showErrorToast("Server error during upload");
  } else if (error instanceof ImageKitUploadNetworkError) {
    showErrorToast("Network error during upload");
  }
};
```

### Validation Errors

```typescript
const validateFile = (file: File): string | null => {
  if (!isAllowedMimeType(file, type)) {
    return `File type not allowed. Allowed types: ${ALLOWED_MIME_TYPES[type].join(", ")}`;
  }

  if (!isValidFileSize(file, FILE_SIZE_LIMITS[type])) {
    return `File size too large. Maximum size: ${FILE_SIZE_LIMITS[type] / (1024 * 1024)}MB`;
  }

  return null;
};
```

## Progress Tracking

### Upload Progress

```tsx
const [progress, setProgress] = useState(0);

// During upload
onProgress: (event) => {
  const percentage = (event.loaded / event.total) * 100;
  setProgress(percentage);
};

// UI feedback
{
  isUploading && (
    <div className="upload-progress">
      <div className="progress-bar" style={{ width: `${progress}%` }} />
      <span>{Math.round(progress)}%</span>
    </div>
  );
}
```

## Rate Limiting

### Upload Limits

```typescript
// lib/essentials/rateLimit.ts
export const uploadAvatarRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 d"), // 10 uploads per day
  analytics: true,
  prefix: "ratelimit:uploadAvatar:daily",
});

export const updateAvatarRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(5, "1 d"), // 5 updates per day
  analytics: true,
  prefix: "ratelimit:updateAvatar:daily",
});
```

## Security Considerations

### File Sanitization

- Remove potentially dangerous characters from filenames
- Validate file extensions match MIME types
- Strip metadata that could contain exploits

### Access Control

- Authenticated users only for avatar uploads
- Admin-only access for book cover uploads
- Public read access for uploaded files

### Storage Security

- Files stored in private folders when sensitive
- Signed URLs for temporary access
- Automatic cleanup of old/unused files

## Performance Optimization

### Image Optimization

ImageKit automatically optimizes uploaded images:

- Multiple formats (WebP, AVIF)
- Responsive breakpoints
- Lazy loading support
- CDN caching

### Upload Chunking

For large files, implement resumable uploads:

```typescript
// Future enhancement
const uploadInChunks = async (file: File) => {
  const chunkSize = 1024 * 1024; // 1MB chunks
  const chunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < chunks; i++) {
    const chunk = file.slice(i * chunkSize, (i + 1) * chunkSize);
    await uploadChunk(chunk, i, chunks);
  }
};
```

## Cost Management

### ImageKit Pricing

- Free tier: 20GB storage, 20GB bandwidth
- Paid plans based on usage
- Optimize storage with automatic format conversion

### Storage Optimization

- Delete old/unused files
- Compress images on upload
- Use appropriate image sizes

## Testing and Development

### Upload Testing

```typescript
// Test file validation
const testFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
console.log(isAllowedMimeType(testFile, "image")); // true
console.log(isValidFileSize(testFile, 1024 * 1024)); // true
```

### Mock Uploads

```typescript
// Development mock for ImageKit
const mockUpload = async (file: File) => {
  return {
    url: `https://mock-imagekit.com/${file.name}`,
    fileId: `mock-${Date.now()}`,
  };
};
```

## Future Enhancements

### Planned Features

- **Bulk Upload** - Multiple file uploads
- **Drag & Drop** - Enhanced UX for file selection
- **Video Upload** - Support for book trailers
- **Image Editing** - Basic editing tools
- **Cloud Migration** - Multi-cloud storage support

## Related Files

- `components/FileUpload.tsx` - Main upload component
- `components/ImageCropper.tsx` - Avatar cropping interface
- `lib/essentials/sanitizeFileExt.ts` - File validation utilities
- `app/api/auth/imagekit/route.ts` - Upload authentication
- `app/api/avatar/route.ts` - Avatar update API
- `lib/essentials/rateLimit.ts` - Upload rate limiting</content>
  <parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\File_Uploads.md
