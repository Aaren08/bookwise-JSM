import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import Image from "next/image";
import { Session } from "next-auth";
import { handleSignOut } from "@/lib/actions/auth";
import { ActiveLink } from "@/components/navigation/ActiveLink";
import { PrefetchOnIntentLink } from "@/lib/performance/PrefetchOnIntentLink";

const Header = ({ session }: { session?: Session | null }) => {
  return (
    <header className="my-10 flex justify-between gap-5">
      <PrefetchOnIntentLink href="/">
        <div className="flex flex-row gap-3">
          <Image
            src="/icons/logo.svg"
            alt="Logo"
            width={40}
            height={40}
            style={{ width: "auto", height: "auto" }}
          />
          <h1 className="text-2xl font-semibold text-light-100 max-sm:hidden">
            BookWise
          </h1>
        </div>
      </PrefetchOnIntentLink>

      <ul className="flex flex-row items-center gap-8">
        <li>
          <ActiveLink
            href="/"
            className="text-base cursor-pointer capitalize"
            activeClassName="text-light-200"
            inactiveClassName="text-light-100"
          >
            Home
          </ActiveLink>
        </li>

        <li>
          <ActiveLink
            href="/search"
            className="text-base cursor-pointer capitalize"
            activeClassName="text-light-200"
            inactiveClassName="text-light-100"
          >
            Search
          </ActiveLink>
        </li>

        {session && (
          <li>
            <PrefetchOnIntentLink href="/my-profile" className="flex items-center gap-2">
              <Avatar>
                <AvatarImage
                  src={session.user?.image || ""}
                  alt={session.user?.name || ""}
                />
                <AvatarFallback className="bg-light-100 font-bold">
                  {getInitials(session.user?.name || "")}
                </AvatarFallback>
              </Avatar>
              <span className="text-light-100 font-semibold">
                {session.user?.name?.split(" ")[0]}
              </span>
            </PrefetchOnIntentLink>
          </li>
        )}

        {session && (
          <li>
            <form action={handleSignOut} className="mt-1">
              <button type="submit" className="cursor-pointer">
                <Image
                  src="/icons/logout.svg"
                  alt="Logout"
                  width={20}
                  height={20}
                />
              </button>
            </form>
          </li>
        )}
      </ul>
    </header>
  );
};

export default Header;
