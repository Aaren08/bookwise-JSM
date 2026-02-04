/**
 * Sanitizes file extensions based on MIME type whitelist
 * This prevents malicious files from being uploaded with incorrect extensions
 */

/**
 * Whitelist of allowed MIME types and their corresponding safe extensions
 */
const MIME_TYPE_WHITELIST: Record<string, string> = {
  // Image types (excluding GIF as per requirements)
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/avif": ".avif",

  // Video types
  "video/mp4": ".mp4",
  "video/mpeg": ".mpeg",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
  "video/3gpp": ".3gp",
  "video/x-flv": ".flv",
  "video/x-ms-wmv": ".wmv",
};

/**
 * Default extensions to use when MIME type is not in whitelist
 */
const DEFAULT_IMAGE_EXTENSION = ".jpg";
const DEFAULT_VIDEO_EXTENSION = ".mp4";

/**
 * Sanitizes a file extension based on its MIME type
 *
 * @param mimeType - The MIME type of the file
 * @param originalFileName - Optional original filename for logging/fallback
 * @returns Safe file extension with leading dot (e.g., ".jpg")
 *
 * @example
 * sanitizeFileExtension("image/png") // returns ".png"
 * sanitizeFileExtension("image/unknown") // returns ".jpg" (default)
 * sanitizeFileExtension("image/jpeg", "photo.jpeg") // returns ".jpg"
 * sanitizeFileExtension("video/mp4") // returns ".mp4"
 */
export function sanitizeFileExtension(
  mimeType: string,
  originalFileName?: string,
): string {
  // Normalize MIME type to lowercase
  const normalizedMimeType = mimeType.toLowerCase().trim();

  // Check if MIME type is in whitelist
  if (normalizedMimeType in MIME_TYPE_WHITELIST) {
    return MIME_TYPE_WHITELIST[normalizedMimeType];
  }

  // Determine default based on MIME type category
  const defaultExtension = normalizedMimeType.startsWith("video/")
    ? DEFAULT_VIDEO_EXTENSION
    : DEFAULT_IMAGE_EXTENSION;

  // Log warning if MIME type is not whitelisted
  if (process.env.NODE_ENV === "development") {
    console.warn(
      `MIME type "${mimeType}" not in whitelist.${
        originalFileName ? ` File: ${originalFileName}.` : ""
      } Using default extension: ${defaultExtension}`,
    );
  }

  return defaultExtension;
}

/**
 * Generates a safe filename with sanitized extension
 *
 * @param baseName - Base name for the file (without extension)
 * @param mimeType - MIME type of the file
 * @returns Safe filename with sanitized extension
 *
 * @example
 * generateSafeFilename("avatar-123456", "image/png") // returns "avatar-123456.png"
 * generateSafeFilename("profile", "image/webp") // returns "profile.webp"
 */
export function generateSafeFilename(
  baseName: string,
  mimeType: string,
): string {
  const sanitizedExtension = sanitizeFileExtension(mimeType);

  // Remove any existing extension from baseName
  const cleanBaseName = baseName.replace(/\.[^/.]+$/, "");

  return `${cleanBaseName}${sanitizedExtension}`;
}

/**
 * Validates if a MIME type is allowed
 *
 * @param mimeType - MIME type to validate
 * @returns true if MIME type is in whitelist, false otherwise
 *
 * @example
 * isAllowedMimeType("image/png") // returns true
 * isAllowedMimeType("image/gif") // returns false
 * isAllowedMimeType("application/pdf") // returns false
 */
export function isAllowedMimeType(mimeType: string): boolean {
  const normalizedMimeType = mimeType.toLowerCase().trim();
  return normalizedMimeType in MIME_TYPE_WHITELIST;
}

/**
 * Gets all allowed MIME types
 *
 * @returns Array of allowed MIME types
 */
export function getAllowedMimeTypes(): string[] {
  return Object.keys(MIME_TYPE_WHITELIST);
}

/**
 * Gets all allowed file extensions
 *
 * @returns Array of allowed file extensions
 */
export function getAllowedExtensions(): string[] {
  return Array.from(new Set(Object.values(MIME_TYPE_WHITELIST)));
}
