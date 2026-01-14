"use client";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { Session } from "next-auth";
import { handleSignOut } from "@/lib/actions/auth";

const Header = ({ session }: { session?: Session | null }) => {
  const pathname = usePathname();
  return (
    <header className="my-10 flex justify-between gap-5">
      <Link href="/">
        <div className="flex flex-row gap-3">
          <Image src="/icons/logo.svg" alt="Logo" width={40} height={40} />
          <h1 className="text-2xl font-semibold text-light-100 max-sm:hidden">
            BookWise
          </h1>
        </div>
      </Link>

      <ul className="flex flex-row items-center gap-8">
        <li>
          <Link
            href="/"
            className={cn(
              "text-base cursor-pointer capitalize",
              pathname === "/" ? "text-light-200" : "text-light-100"
            )}
          >
            Home
          </Link>
        </li>

        <li>
          <Link
            href="/search"
            className={cn(
              "text-base cursor-pointer capitalize",
              pathname === "/search" ? "text-light-200" : "text-light-100"
            )}
          >
            Search
          </Link>
        </li>

        {session && (
          <li>
            <Link href="/my-profile" className="flex items-center gap-2">
              <Avatar>
                <AvatarFallback className="bg-light-100 font-bold">
                  {getInitials(session.user?.name || "")}
                </AvatarFallback>
              </Avatar>
              <span className="text-light-100 font-semibold">
                {session.user?.name?.split(" ")[0]}
              </span>
            </Link>
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
