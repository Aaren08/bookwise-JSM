import { useRouter } from "next/navigation";
import { useState, useRef, useCallback } from "react";
import Cropper, { Area } from "react-easy-crop";
import getCroppedImg from "@/lib/essentials/imageCrop";
import { upload } from "@imagekit/next";
import { cn } from "@/lib/utils";
import "@/app/styles/animate.css";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { showErrorToast, showSuccessToast } from "@/lib/essentials/toast-utils";

interface ImageCropperProps {
  userAvatar: string;
  onAvatarUpdated: (url: string) => void;
}

const ImageCropper = ({ userAvatar, onAvatarUpdated }: ImageCropperProps) => {
  const router = useRouter();
  const { data: session, update } = useSession();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showCropper, setShowCropper] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setImageSrc(reader.result?.toString() || null);
        setShowCropper(true);
      });
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback(
    (croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    [],
  );

  const authenticator = async () => {
    try {
      const response = await fetch("/api/auth/imagekit");
      if (!response.ok) {
        throw new Error("Authentication request failed");
      }
      return await response.json();
    } catch (error) {
      console.error("Authentication error:", error);
      throw error;
    }
  };

  const handleUpload = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    try {
      setIsUploading(true);
      setShowCropper(false);

      const croppedImageBlob = (await getCroppedImg(
        imageSrc,
        croppedAreaPixels,
        rotation,
      )) as string;

      const response = await fetch(croppedImageBlob);
      const blob = await response.blob();
      const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });

      const authParams = await authenticator();

      const uploadResponse = await upload({
        file,
        fileName: `avatar-${Date.now()}.jpg`,
        folder: "/users/avatars",
        ...authParams,
      });

      if (uploadResponse.url) {
        // Call API route to update user avatar with rate limiting
        const apiResponse = await fetch("/api/avatar", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            imageUrl: uploadResponse.url,
            fileId: uploadResponse.fileId,
          }),
        });

        const result = await apiResponse.json();

        if (apiResponse.ok && result.success) {
          // Update local state immediately for instant feedback
          onAvatarUpdated(uploadResponse.url);

          // Update session with new image URL - this is crucial for persistence
          await update({
            ...session,
            user: {
              ...session?.user,
              image: uploadResponse.url,
            },
          });

          showSuccessToast("Profile updated successfully");

          // Refresh the router to update all components
          router.refresh();
        } else {
          showErrorToast(result.error || "Failed to update profile image");
        }
      }
    } catch (error) {
      console.error("Upload error:", error);
      showErrorToast("Failed to upload image");
    } finally {
      setIsUploading(false);
      setImageSrc(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <>
      {/* File Input */}
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={onFileChange}
        className="hidden"
      />

      {/* Cropper Modal */}
      {showCropper && (
        <div className="cropper-modal">
          <div className="cropper-content">
            <div className="cropper-image_container">
              <Cropper
                image={imageSrc!}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={1}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
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
                  aria-labelledby="Zoom"
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="cropper-zoom_input"
                />
              </div>

              <div className="cropper-btn_container">
                <button
                  onClick={() => {
                    setShowCropper(false);
                    setImageSrc(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  className="cropper-cancel_btn"
                >
                  Cancel
                </button>
                <button onClick={handleUpload} className="cropper-save_btn">
                  Save & Upload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trigger Button / Avatar Display */}
      <div
        className="cropper-avatar_trigger"
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        <div className="cropper-avatar_circle">
          {isUploading ? (
            <div className="loader" />
          ) : (
            <>
              <Image
                src={userAvatar || "/icons/user-fill.svg"}
                alt="user avatar"
                fill={!!userAvatar}
                width={!userAvatar ? 40 : undefined}
                height={!userAvatar ? 40 : undefined}
                className={cn(
                  "object-cover",
                  !userAvatar && "object-contain w-10 h-10",
                )}
              />

              {/* Hover Overlay */}
              <div className="cropper-hover_overlay">
                <Image
                  src={
                    userAvatar && userAvatar !== "/icons/user-fill.svg"
                      ? "/icons/edit.svg"
                      : "/icons/camera.svg"
                  }
                  alt="upload"
                  width={24}
                  height={24}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ImageCropper;
