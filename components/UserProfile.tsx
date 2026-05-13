"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AvatarUploadControls from "@/components/AvatarUploadControls";
import {
  AvatarUploadResult,
  useAvatarUpload,
} from "@/lib/global/essentials/use-avatar-upload";
import { showSuccessToast } from "@/lib/essentials/toast-utils";
import { useSystemConfig } from "@/lib/store/system-config-store";

const UserProfile = ({
  fullName,
  email,
  universityId,
  universityCard,
  userAvatar,
  status = "PENDING",
}: UserProfileProps) => {
  const router = useRouter();
  const { data: session, update } = useSession();
  const { instituteName } = useSystemConfig();

  const avatarUpload = useAvatarUpload({
    initialAvatar: session?.user?.image || userAvatar,
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

  const getStatusConfig = () => {
    switch (status) {
      case "APPROVED":
        return {
          icon: "/icons/verified.svg",
          text: "Verified Student",
        };
      case "REJECTED":
        return {
          icon: "/icons/unapproved.svg",
          text: "Account Rejected",
        };
      case "PENDING":
      default:
        return {
          icon: "/icons/unverified.svg",
          text: "Unverified Student",
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="relative">
      {/* Profile Background Shape */}
      <div className="profile-bg_container">
        <Image
          src="/icons/profile.svg"
          alt="profile background"
          width={59}
          height={88}
          className="object-contain"
          priority
        />
      </div>

      {/* User Profile Card */}
      <div className="profile-card">
        <div className="profile-header">
          <AvatarUploadControls avatarUpload={avatarUpload} />

          <div className="profile-details">
            {/* Status Badge */}
            <div className="profile-status_badge">
              <Image
                src={statusConfig.icon}
                alt={statusConfig.text}
                width={18}
                height={18}
              />
              <p className="profile-status_text">{statusConfig.text}</p>
            </div>

            {/* User Info */}
            <h2 className="profile-name">{fullName}</h2>
            <p className="profile-email">{email}</p>
          </div>
        </div>

        {/* University Info */}
        <div className="profile-info_container">
          <div>
            <p className="profile-info_label">University</p>
            <p className="profile-info_value">{instituteName}</p>
          </div>

          <div>
            <p className="profile-info_label">Student ID</p>
            <p className="profile-info_value">{universityId}</p>
          </div>
        </div>

        {/* University Card */}
        <div className="profile-info_item">
          <div className="profile-university_card">
            <Image
              src={universityCard}
              alt="university card"
              fill
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
