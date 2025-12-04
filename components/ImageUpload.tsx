"use client";

import {
  ImageKitAbortError,
  ImageKitInvalidRequestError,
  ImageKitServerError,
  ImageKitUploadNetworkError,
  upload,
} from "@imagekit/next";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

interface ImageUploadProps {
  onUploadComplete?: (url: string) => void;
  onUploadError?: (error: string) => void;
}

const ImageUpload = ({ onUploadComplete, onUploadError }: ImageUploadProps) => {
  const [progress, setProgress] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState<string>("");
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
          `Request failed with status ${response.status}: ${errorText}`
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

      // Upload the file
      const uploadResponse = await upload({
        expire,
        token,
        signature,
        publicKey,
        file,
        fileName: file.name,
        onProgress: (event) => {
          const progressPercentage = (event.loaded / event.total) * 100;
          setProgress(progressPercentage);
        },
        abortSignal: abortControllerRef.current.signal,
      });

      // Handle successful upload
      if (uploadResponse.url) {
        setUploadedUrl(uploadResponse.url);
        onUploadComplete?.(uploadResponse.url);
      }
      setIsUploading(false);

      // Show success toast
      toast.success("Upload successful", {
        description: "Your university card has been uploaded successfully",
        position: "top-right",
        style: {
          background: "#dcfce7",
          color: "#000000",
          border: "1px solid #86efac",
        },
        className: "!bg-green-200 !text-black",
      });
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
        toast.error("Upload failed", {
          description:
            "Your university card upload failed. Please try again later.",
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
      }
    }
  };

  /**
   * Handles file input change
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type (images only)
      if (!file.type.startsWith("image/")) {
        const errorMsg = "Please select an image file";
        onUploadError?.(errorMsg);

        // Show error toast
        toast.error("Invalid file type", {
          description: errorMsg,
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        const errorMsg = "File size must be less than 10MB";
        onUploadError?.(errorMsg);

        // Show error toast
        toast.error("File too large", {
          description: errorMsg,
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
        return;
      }

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
    setUploadedUrl("");
    setProgress(0);
    setFileName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onUploadComplete?.("");

    // Show info toast
    toast.info("Image removed", {
      description: "You can upload a new university card",
      position: "top-right",
      style: {
        background: "#fee2e2",
        color: "#000000",
        border: "1px solid #fca5a5",
      },
      className: "!bg-orange-100 !text-black",
    });
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
    toast.warning("Upload cancelled", {
      description: "The upload process was cancelled",
      position: "top-right",
      style: {
        background: "#fee2e2",
        color: "#000000",
        border: "1px solid #fca5a5",
      },
      className: "!bg-orange-100 !text-black",
    });
  };

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
        disabled={isUploading}
      />

      {!uploadedUrl && !isUploading && (
        <button type="button" onClick={handleClick} className="upload-file">
          <Image
            src="/icons/upload.svg"
            alt="Upload university card"
            width={20}
            height={20}
          />
          <span className="text-light-100 font-normal">Upload a file</span>
        </button>
      )}

      {isUploading && (
        <div className="w-full space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-light-100 truncate flex-1">
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

      {uploadedUrl && !isUploading && (
        <div className="relative w-full min-h-14 border-2 border-green-600 rounded-lg overflow-hidden bg-dark-300">
          <Image
            src={uploadedUrl}
            alt="Uploaded university card"
            width={200}
            height={100}
            className="w-full h-auto object-contain"
          />
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

export default ImageUpload;
