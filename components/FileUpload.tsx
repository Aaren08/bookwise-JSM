"use client";

import {
  ImageKitAbortError,
  ImageKitInvalidRequestError,
  ImageKitServerError,
  ImageKitUploadNetworkError,
  upload,
  Video,
} from "@imagekit/next";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import Image from "next/image";
import config from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  showFileErrorToast,
  showFileInfoToast,
  showFileSuccessToast,
  showFileWarningToast,
} from "@/lib/essentials/toast-utils";
import {
  generateSafeFilename,
  isAllowedMimeType,
} from "@/lib/essentials/sanitizeFileExt";

const FileUpload = ({
  onUploadComplete,
  onUploadError,
  onChange,
  value,
  type = "image",
  variant = "dark",
  placeholder = "Upload a file",
  folder = "",
  accept,
}: FileUploadProps) => {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Authenticates and retrieves upload credentials from the server
   */
  const authenticator = async () => {
    try {
      const response = await fetch("/api/auth/imagekit");
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Request failed with status ${response.status}: ${errorText}`,
        );
      }

      const data = await response.json();
      const { signature, expire, token, publicKey } = data;
      return { signature, expire, token, publicKey };
    } catch (error) {
      console.error("Authentication error:", error);
      throw new Error("Authentication request failed");
    }
  };

  /**
   * Handles the file upload process
   */
  const handleUpload = async (file: File) => {
    // Create new AbortController for this upload
    abortControllerRef.current = new AbortController();

    setIsUploading(true);
    setProgress(0);
    setFileName(file.name);

    try {
      // Get authentication parameters
      const authParams = await authenticator();
      const { signature, expire, token, publicKey } = authParams;

      // Generate safe filename with sanitized extension
      const safeFileName = generateSafeFilename(
        `upload-${Date.now()}`,
        file.type,
      );

      // Upload the file
      const uploadResponse = await upload({
        expire,
        token,
        signature,
        publicKey,
        file,
        fileName: safeFileName,
        folder: folder,
        onProgress: (event) => {
          const progressPercentage = (event.loaded / event.total) * 100;
          setProgress(progressPercentage);
        },
        abortSignal: abortControllerRef.current.signal,
      });

      // Handle successful upload
      if (uploadResponse.url) {
        onUploadComplete?.(uploadResponse.url);
        onChange?.(uploadResponse.url);
      }
      setIsUploading(false);

      // Show success toast
      showFileSuccessToast(
        "Upload successful",
        `${type === "image" ? "Image" : "Video"} uploaded successfully`,
      );
    } catch (error) {
      // Handle errors
      let errorMessage = "Upload failed";
      let isAbortError = false;

      if (error instanceof ImageKitAbortError) {
        errorMessage = "Upload cancelled";
        isAbortError = true;
        console.error("Upload aborted:", error.reason);
      } else if (error instanceof ImageKitInvalidRequestError) {
        errorMessage = "Invalid file or request";
        console.error("Invalid request:", error.message);
      } else if (error instanceof ImageKitUploadNetworkError) {
        errorMessage = "Network error occurred";
        console.error("Network error:", error.message);
      } else if (error instanceof ImageKitServerError) {
        errorMessage = "Server error occurred";
        console.error("Server error:", error.message);
      } else {
        console.error("Upload error:", error);
      }

      onUploadError?.(errorMessage);
      setIsUploading(false);
      setProgress(0);
      setFileName("");

      // Reset file input to allow re-upload
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Show error toast only if it's not a cancellation
      // (handleCancel already shows the "Upload cancelled" toast)
      if (!isAbortError) {
        showFileErrorToast(
          "Upload failed",
          `Your ${type} upload failed. Please try again later.`,
        );
      }
    }
  };

  /**
   * Handles file input change
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check MIME type whitelist first (most important check)
      if (!isAllowedMimeType(file.type)) {
        const errorMsg = `File type ${file.type} is not allowed`;
        onUploadError?.(errorMsg);
        showFileErrorToast("Invalid file type", errorMsg);
        return;
      }

      // Validate file type category matches component type
      if (type === "image" && !file.type.startsWith("image/")) {
        const errorMsg = "Please select an image file";
        onUploadError?.(errorMsg);
        showFileErrorToast("Invalid file type", errorMsg);
        return;
      }

      if (type === "video" && !file.type.startsWith("video/")) {
        const errorMsg = "Please select a video file";
        onUploadError?.(errorMsg);
        showFileErrorToast("Invalid file type", errorMsg);
        return;
      }

      // Validate file size
      const maxSize = type === "image" ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
      if (file.size > maxSize) {
        const errorMsg = `File size must be less than ${
          type === "image" ? "10MB" : "50MB"
        }`;
        onUploadError?.(errorMsg);
        showFileErrorToast("File too large", errorMsg);
        return;
      }

      // ✅ All validations passed, proceed with upload
      handleUpload(file);
    }
  };

  /**
   * Triggers file input click
   */
  const handleClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Removes uploaded image
   */
  const handleRemove = () => {
    setProgress(0);
    setFileName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onUploadComplete?.("");
    onChange?.("");

    // Show info toast
    showFileInfoToast("File removed", "You can upload a new file");
  };

  /**
   * Cancels ongoing upload
   */
  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setIsUploading(false);
    setProgress(0);
    setFileName("");

    // Show warning toast
    showFileWarningToast(
      "Upload cancelled",
      "The upload process was cancelled",
    );
  };

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={accept || (type === "image" ? "image/*" : "video/*")}
        className="hidden"
        disabled={isUploading}
      />

      {!value && !isUploading && (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "upload-file",
            variant === "dark"
              ? "bg-dark-300 text-light-100"
              : "bg-light-600 text-dark-100 border border-gray-300",
          )}
        >
          <Image
            src="/icons/upload.svg"
            alt="Upload file"
            width={20}
            height={20}
          />
          <span
            className={cn(
              "font-normal",
              variant === "dark" ? "text-light-100" : "text-dark-500",
            )}
          >
            {placeholder}
          </span>
        </button>
      )}

      {isUploading && (
        <div className="w-full space-y-2">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "text-sm truncate flex-1",
                variant === "dark" ? "text-light-100" : "text-dark-500",
              )}
            >
              {fileName}
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="text-red-500 hover:text-red-400 ml-2 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="w-full bg-dark-500 rounded-full h-2 overflow-hidden">
            <div
              className="progress h-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}

      {value && !isUploading && (
        <div
          className={cn(
            "relative w-full rounded-lg overflow-hidden",
            variant === "dark"
              ? "bg-dark-300 border-green-600"
              : "bg-light-600 border-gray-300",
            type === "image" ? "min-h-14 border-2" : "aspect-video border-none",
          )}
        >
          {type === "image" ? (
            <Image
              src={value}
              alt="Uploaded file"
              width={200}
              height={100}
              className="w-full h-auto object-contain"
            />
          ) : (
            <Video
              src={value}
              controls={true}
              className="w-full h-full rounded-lg"
              urlEndpoint={config.env.imagekit.urlEndpoint}
            />
          )}
          <button
            type="button"
            onClick={handleRemove}
            className="file-remove-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
