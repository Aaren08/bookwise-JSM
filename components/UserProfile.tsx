"use client";

import Image from "next/image";
import ImageCropper from "./ImageCropper";
import { useState } from "react";
import { useSession } from "next-auth/react";

const UserProfile = ({
  fullName,
  email,
  universityId,
  universityCard,
  userAvatar,
  status = "PENDING",
}: UserProfileProps) => {
  const { data: session } = useSession();

  // Track locally uploaded avatar (before it's saved to session)
  const [uploadedAvatar, setUploadedAvatar] = useState<string | null>(null);

  // Derive the current avatar: prioritize uploaded > session > prop
  const currentAvatar = uploadedAvatar || session?.user?.image || userAvatar;

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
          <ImageCropper
            userAvatar={currentAvatar}
            onAvatarUpdated={setUploadedAvatar}
          />

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
            <p className="profile-info_value">JS Mastery Pro</p>
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
