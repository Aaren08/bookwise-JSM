import Image from "next/image";

interface UserProfileProps {
  fullName: string;
  email: string;
  universityId: string;
  universityCard: string;
}

const UserProfile = ({
  fullName,
  email,
  universityId,
  universityCard,
}: UserProfileProps) => {
  return (
    <div className="relative">
      {/* Profile Background Shape */}
      <div className="absolute top-0 left-0 w-full flex justify-center">
        <Image
          src="/icons/profile.svg"
          alt="profile background"
          width={59}
          height={88}
          className="object-contain"
        />
      </div>

      {/* User Profile Card */}
      <div className="gradient-vertical rounded-2xl p-8 pt-16 flex flex-col items-center">
        <div className="flex items-start justify-start w-full gap-5 mt-14">
          <div className="relative shrink-0">
            <div className="w-22 h-22 rounded-full bg-dark-600 flex items-center justify-center border-4 border-dark-300">
              <Image
                src="/icons/user-fill.svg"
                alt="user avatar"
                width={40}
                height={40}
                className="object-contain"
              />
            </div>
          </div>

          <div className="flex flex-col">
            {/* Verified Badge */}
            <div className="flex items-center gap-2">
              <Image
                src="/icons/verified.svg"
                alt="verified"
                width={18}
                height={18}
              />
              <p className="text-light-100 text-sm font-medium">
                Verified Student
              </p>
            </div>

            {/* User Info */}
            <h2 className="text-white text-xl font-semibold mt-2">
              {fullName}
            </h2>
            <p className="text-light-100 text-sm mt-1">{email}</p>
          </div>
        </div>

        {/* University Info */}
        <div className="w-full mt-6 space-y-4">
          <div>
            <p className="text-light-200 text-xs tracking-wider">University</p>
            <p className="text-white text-base font-semibold mt-1">
              JS Mastery Pro
            </p>
          </div>

          <div>
            <p className="text-light-200 text-xs tracking-wider">Student ID</p>
            <p className="text-white text-base font-semibold mt-1">
              {universityId}
            </p>
          </div>
        </div>

        {/* University Card */}
        <div className="w-full mt-6">
          <div className="relative w-full h-48 rounded-lg overflow-hidden border border-dark-600">
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
