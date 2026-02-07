import Image from "next/image";
import { getInitials } from "@/lib/utils";
import { getAvatarColor } from "@/lib/admin/avatarColors";

interface AccountRequestCardsProps {
  requests: {
    id: string;
    userAvatar: string | null;
    fullName: string;
    email: string;
  }[];
}

const AccountRequestCards = ({ requests }: AccountRequestCardsProps) => {
  return (
    <div className="account-requests-grid">
      {requests.map((request, index) => (
        <div
          key={request.id}
          className={`account-request-card ${index >= 6 ? "max-sm:hidden" : ""}`}
        >
          <div className="account-request-card_upper">
            <div className="size-16">
              {request.userAvatar ? (
                <Image
                  src={request.userAvatar}
                  alt={request.fullName}
                  width={64}
                  height={64}
                  className="rounded-full object-cover size-full"
                />
              ) : (
                <div
                  className={`account-request-card-avatar_initials ${
                    getAvatarColor(request.email || request.fullName).bg
                  } ${getAvatarColor(request.email || request.fullName).text}`}
                >
                  {getInitials(request.fullName)}
                </div>
              )}
            </div>
            <div className="account-request-card_info">
              <p className="font-semibold text-base text-dark-400 truncate w-full">
                {request.fullName}
              </p>
              <p className="text-sm text-light-500 truncate w-full">
                {request.email}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AccountRequestCards;
