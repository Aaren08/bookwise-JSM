"use client";

import { memo } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PrefetchOnIntentLink } from "@/lib/performance/PrefetchOnIntentLink";

const AdminSidebarLinkComponent = ({
  href,
  icon,
  label,
}: AdminSidebarLinkProps) => {
  const pathname = usePathname();
  const isSelected =
    (href !== "/admin" && pathname.startsWith(href)) || pathname === href;

  return (
    <PrefetchOnIntentLink href={href}>
      <div className={cn("link", isSelected && "bg-primary-admin shadow-sm")}>
        <div className="relative size-5">
          <Image
            src={icon}
            alt=""
            fill
            className={cn(
              isSelected && "brightness-0 invert",
              "object-contain",
            )}
          />
        </div>
        <p className={cn(isSelected ? "text-white" : "text-dark")}>{label}</p>
      </div>
    </PrefetchOnIntentLink>
  );
};

export const AdminSidebarLink = memo(AdminSidebarLinkComponent);
