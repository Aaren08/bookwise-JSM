"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { cn } from "@/lib/utils";
import type { UseAvatarUploadReturn } from "@/lib/global/essentials/use-avatar-upload";

interface AvatarUploadControlsProps {
  avatarUpload: UseAvatarUploadReturn;
  ariaLabel?: string;
  saveLabel?: string;
  triggerClassName?: string;
  avatarClassName?: string;
  hoverOverlayClassName?: string;
  fallbackAvatar?: string;
}

const AvatarUploadControls = ({
  avatarUpload,
  ariaLabel = "Change avatar",
  saveLabel = "Save & Upload",
  triggerClassName,
  avatarClassName,
  hoverOverlayClassName,
  fallbackAvatar = "/icons/user-fill.svg",
}: AvatarUploadControlsProps) => {
  const {
    currentAvatar,
    crop,
    zoom,
    isUploading,
    isCropperOpen,
    previewImage,
    fileInputRef,
    setCrop,
    setZoom,
    openFilePicker,
    handleImageChange,
    handleCropComplete,
    uploadCroppedImage,
    closeCropper,
  } = avatarUpload;
  const hasCustomAvatar = !!currentAvatar && currentAvatar !== fallbackAvatar;

  return (
    <>
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleImageChange}
        className="hidden"
      />

      {isCropperOpen && previewImage && typeof document !== "undefined" && createPortal(
        <div className="cropper-modal">
          <div className="cropper-content">
            <div className="cropper-image_container">
              <Cropper
                image={previewImage}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onCropComplete={handleCropComplete}
                onZoomChange={setZoom}
                showGrid={true}
                cropShape="round"
              />
            </div>

            <div className="cropper-controls">
              <div className="cropper-zoom_slider">
                <span className="text-sm text-light-200">Zoom</span>
                <input
                  type="range"
                  value={zoom}
                  min={1}
                  max={3}
                  step={0.1}
                  aria-label="Zoom"
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="cropper-zoom_input"
                />
              </div>

              <div className="cropper-btn_container">
                <button
                  type="button"
                  onClick={closeCropper}
                  className="cropper-cancel_btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={uploadCroppedImage}
                  className="cropper-save_btn"
                >
                  {saveLabel}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      <button
        type="button"
        className={cn("cropper-avatar_trigger", triggerClassName)}
        onClick={openFilePicker}
        disabled={isUploading}
        aria-label={ariaLabel}
      >
        <div className={cn("cropper-avatar_circle", avatarClassName)}>
          {isUploading ? (
            <div className="loader" />
          ) : (
            <>
              <Image
                src={currentAvatar}
                alt="user avatar"
                fill={hasCustomAvatar}
                width={!hasCustomAvatar ? 40 : undefined}
                height={!hasCustomAvatar ? 40 : undefined}
                className={cn(
                  "object-cover",
                  !hasCustomAvatar && "object-contain w-10 h-10",
                )}
              />

              <div
                className={cn("cropper-hover_overlay", hoverOverlayClassName)}
              >
                <Image
                  src={
                    hasCustomAvatar ? "/icons/edit.svg" : "/icons/camera.svg"
                  }
                  alt="upload"
                  width={24}
                  height={24}
                />
              </div>
            </>
          )}
        </div>
      </button>
    </>
  );
};

export default AvatarUploadControls;
