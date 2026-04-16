"use client";

import { memo } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PrefetchOnIntentLink } from "@/lib/performance/PrefetchOnIntentLink";

const ActiveLinkComponent = ({
  href,
  children,
  activeClassName,
  inactiveClassName,
  className,
  exact = true,
}: ActiveLinkProps) => {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);

  return (
    <PrefetchOnIntentLink
      href={href}
      className={cn(className, isActive ? activeClassName : inactiveClassName)}
    >
      {children}
    </PrefetchOnIntentLink>
  );
};

export const ActiveLink = memo(ActiveLinkComponent);
