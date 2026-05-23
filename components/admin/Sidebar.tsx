import { db } from "@/database/drizzle";
import { appSettings } from "@/database/schema";
import { eq } from "drizzle-orm";
import { adminSideBarLinks } from "@/constants";
import { getInitials } from "@/lib/utils";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Session } from "next-auth";
import { handleSignOut } from "@/lib/actions/auth";
import { AdminSidebarLink } from "@/components/navigation/AdminSidebarLink";

const Sidebar = async ({ session }: { session: Session }) => {
  const displayName = session.user?.name || session.user?.email || "Admin";
  const displayEmail = session.user?.email || "";
  const displayImage = session.user?.image || "";

  const [settings] = await db
    .select({ universityName: appSettings.universityName })
    .from(appSettings)
    .where(eq(appSettings.id, true))
    .limit(1);

  const universityName = settings?.universityName || "BookWise";

  return (
    <div className="admin-sidebar">
      <div>
        <div className="logo">
          <Image
            src="/icons/admin/logo.svg"
            alt="logo"
            height={37}
            width={37}
          />
          <h1 className="truncate">{universityName}</h1>
        </div>

        <div className="mt-10 flex flex-col gap-5">
          {adminSideBarLinks.map((link) => (
            <AdminSidebarLink
              key={link.route}
              href={link.route}
              icon={link.img}
              label={link.text}
            />
          ))}
        </div>
      </div>

      <div className="user relative flex flex-wrap">
        <div className="relative">
          <Avatar className="size-10">
            <AvatarImage
              src={displayImage}
              alt={displayName}
            />
            <AvatarFallback className="bg-light-100 font-bold">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="size-3 rounded-full bg-green-500 absolute bottom-0 right-0" />
        </div>

        <div className="flex flex-row min-w-0 flex-1">
          <div className="flex flex-col max-md:hidden min-w-0 flex-1">
            <p className="text-dark-200 font-semibold truncate">
              {displayName}
            </p>
            <p className="text-xs text-light-500 truncate">
              {displayEmail}
            </p>
          </div>
          <form action={handleSignOut} className="mt-2.5 ml-2.5 shrink-0">
            <button type="submit" className="cursor-pointer">
              <Image
                src="/icons/logout.svg"
                alt="Logout"
                width={20}
                height={20}
              />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
