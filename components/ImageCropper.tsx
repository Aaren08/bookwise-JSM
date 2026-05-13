"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AvatarUploadControls from "@/components/AvatarUploadControls";
import {
  AvatarUploadResult,
  useAvatarUpload,
  UseAvatarUploadReturn,
} from "@/lib/global/essentials/use-avatar-upload";
import { showSuccessToast } from "@/lib/essentials/toast-utils";

interface ImageCropperProps {
  userAvatar?: string | null;
  avatarUpload?: UseAvatarUploadReturn;
  fallbackAvatar?: string;
  ariaLabel?: string;
  saveLabel?: string;
  triggerClassName?: string;
  avatarClassName?: string;
  hoverOverlayClassName?: string;
}

const ImageCropper = ({
  userAvatar,
  avatarUpload,
  fallbackAvatar,
  ariaLabel,
  saveLabel,
  triggerClassName,
  avatarClassName,
  hoverOverlayClassName,
}: ImageCropperProps) => {
  if (avatarUpload) {
    return (
      <AvatarUploadControls
        avatarUpload={avatarUpload}
        fallbackAvatar={fallbackAvatar}
        ariaLabel={ariaLabel}
        saveLabel={saveLabel}
        triggerClassName={triggerClassName}
        avatarClassName={avatarClassName}
        hoverOverlayClassName={hoverOverlayClassName}
      />
    );
  }

  return (
    <ProfileImageCropper
      userAvatar={userAvatar}
      fallbackAvatar={fallbackAvatar}
      ariaLabel={ariaLabel}
      saveLabel={saveLabel}
      triggerClassName={triggerClassName}
      avatarClassName={avatarClassName}
      hoverOverlayClassName={hoverOverlayClassName}
    />
  );
};

const ProfileImageCropper = ({
  userAvatar,
  fallbackAvatar,
  ariaLabel,
  saveLabel,
  triggerClassName,
  avatarClassName,
  hoverOverlayClassName,
}: Omit<ImageCropperProps, "avatarUpload">) => {
  const router = useRouter();
  const { data: session, update } = useSession();

  const profileAvatarUpload = useAvatarUpload({
    initialAvatar: session?.user?.image || userAvatar,
    fallbackAvatar,
    async onUploadComplete(result: AvatarUploadResult) {
      const apiResponse = await fetch("/api/avatar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: result.url,
          fileId: result.fileId,
        }),
      });

      const apiResult = await apiResponse.json();

      if (!apiResponse.ok || !apiResult.success) {
        throw new Error(apiResult.error || "Failed to update profile image");
      }

      await update({
        ...session,
        user: {
          ...session?.user,
          image: result.url,
        },
      });

      showSuccessToast("Profile updated successfully");
      router.refresh();
    },
  });

  return (
    <AvatarUploadControls
      avatarUpload={profileAvatarUpload}
      fallbackAvatar={fallbackAvatar}
      ariaLabel={ariaLabel}
      saveLabel={saveLabel}
      triggerClassName={triggerClassName}
      avatarClassName={avatarClassName}
      hoverOverlayClassName={hoverOverlayClassName}
    />
  );
};

export default ImageCropper;
