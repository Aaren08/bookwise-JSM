"use client";

import { useCallback, useRef, useState } from "react";
import type { Area, Point } from "react-easy-crop";
import { upload } from "@imagekit/next";
import getCroppedImg from "@/lib/essentials/imageCrop";
import {
  generateSafeFilename,
  isAllowedMimeType,
} from "@/lib/essentials/sanitizeFileExt";
import {
  showErrorToast,
  showFileErrorToast,
} from "@/lib/essentials/toast-utils";

export interface AvatarUploadResult {
  url: string;
  fileId?: string;
  fileName: string;
}

interface ImageKitAuthParams {
  signature: string;
  expire: number;
  token: string;
  publicKey: string;
}

interface UseAvatarUploadOptions {
  initialAvatar?: string | null;
  fallbackAvatar?: string;
  folder?: string;
  fileNamePrefix?: string;
  onUploadComplete?: (
    result: AvatarUploadResult,
  ) => Promise<boolean | void> | boolean | void;
}

export interface UseAvatarUploadReturn {
  selectedImage: File | null;
  previewImage: string | null;
  croppedImage: string | null;
  uploadedImage: string | null;
  currentAvatar: string;
  crop: Point;
  zoom: number;
  croppedAreaPixels: Area | null;
  isUploading: boolean;
  isCropperOpen: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  setCrop: (crop: Point) => void;
  setZoom: (zoom: number) => void;
  openFilePicker: () => void;
  handleImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleCropComplete: (croppedArea: Area, croppedAreaPixels: Area) => void;
  uploadCroppedImage: () => Promise<AvatarUploadResult | null>;
  closeCropper: () => void;
  resetAvatarUpload: () => void;
  removeAvatar: () => void;
}

const DEFAULT_FALLBACK_AVATAR = "/icons/user-fill.svg";

const authenticateImageKit = async (): Promise<ImageKitAuthParams> => {
  const response = await fetch("/api/auth/imagekit");

  if (!response.ok) {
    throw new Error("Authentication request failed");
  }

  return response.json();
};

export const useAvatarUpload = ({
  initialAvatar,
  fallbackAvatar = DEFAULT_FALLBACK_AVATAR,
  folder = "/users/avatars",
  fileNamePrefix = "avatar",
  onUploadComplete,
}: UseAvatarUploadOptions = {}): UseAvatarUploadReturn => {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentAvatar = uploadedImage || initialAvatar || fallbackAvatar;

  const clearFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const resetCropState = useCallback(() => {
    setSelectedImage(null);
    setPreviewImage(null);
    setCroppedAreaPixels(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const openFilePicker = useCallback(() => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  }, [isUploading]);

  const handleImageChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) return;

      if (!isAllowedMimeType(file.type)) {
        showFileErrorToast(
          "Invalid file type",
          `File type ${file.type} is not allowed. Please upload a valid image file.`,
        );
        clearFileInput();
        return;
      }

      const reader = new FileReader();

      reader.addEventListener("load", () => {
        setSelectedImage(file);
        setPreviewImage(reader.result?.toString() || null);
        setIsCropperOpen(true);
      });

      reader.readAsDataURL(file);
    },
    [clearFileInput],
  );

  const handleCropComplete = useCallback(
    (_croppedArea: Area, nextCroppedAreaPixels: Area) => {
      setCroppedAreaPixels(nextCroppedAreaPixels);
    },
    [],
  );

  const closeCropper = useCallback(() => {
    setIsCropperOpen(false);
    resetCropState();
    clearFileInput();
  }, [clearFileInput, resetCropState]);

  const uploadCroppedImage = useCallback(async () => {
    if (!previewImage || !croppedAreaPixels) return null;

    try {
      setIsUploading(true);
      setIsCropperOpen(false);

      const croppedImageDataUrl = (await getCroppedImg(
        previewImage,
        croppedAreaPixels,
      )) as string;

      const response = await fetch(croppedImageDataUrl);
      const blob = await response.blob();

      if (!isAllowedMimeType(blob.type)) {
        throw new Error("Invalid image type. Please upload a valid image file.");
      }

      const safeFileName = generateSafeFilename(
        `${fileNamePrefix}-${Date.now()}`,
        blob.type,
      );
      const file = new File([blob], safeFileName, { type: blob.type });
      const authParams = await authenticateImageKit();

      const uploadResponse = await upload({
        file,
        fileName: safeFileName,
        folder,
        ...authParams,
      });

      if (!uploadResponse.url) {
        throw new Error("Image upload did not return a URL");
      }

      const result: AvatarUploadResult = {
        url: uploadResponse.url,
        fileId: uploadResponse.fileId,
        fileName: safeFileName,
      };

      const shouldKeepUpload = await onUploadComplete?.(result);

      if (shouldKeepUpload !== false) {
        setCroppedImage(croppedImageDataUrl);
        setUploadedImage(uploadResponse.url);
      }

      return result;
    } catch (error) {
      console.error("Avatar upload error:", error);
      showErrorToast(
        error instanceof Error ? error.message : "Failed to upload image",
      );
      return null;
    } finally {
      setIsUploading(false);
      resetCropState();
      clearFileInput();
    }
  }, [
    clearFileInput,
    croppedAreaPixels,
    fileNamePrefix,
    folder,
    onUploadComplete,
    previewImage,
    resetCropState,
  ]);

  const resetAvatarUpload = useCallback(() => {
    setUploadedImage(null);
    setCroppedImage(null);
    setIsCropperOpen(false);
    resetCropState();
    clearFileInput();
  }, [clearFileInput, resetCropState]);

  const removeAvatar = useCallback(() => {
    resetAvatarUpload();
  }, [resetAvatarUpload]);

  return {
    selectedImage,
    previewImage,
    croppedImage,
    uploadedImage,
    currentAvatar,
    crop,
    zoom,
    croppedAreaPixels,
    isUploading,
    isCropperOpen,
    fileInputRef,
    setCrop,
    setZoom,
    openFilePicker,
    handleImageChange,
    handleCropComplete,
    uploadCroppedImage,
    closeCropper,
    resetAvatarUpload,
    removeAvatar,
  };
};
