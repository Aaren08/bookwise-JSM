"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  bumpTopLoaderForRouteCommit,
  completeTopLoader,
  shouldStartProgressForAnchorClick,
  startTopLoader,
  startTopLoaderForHref,
} from "@/lib/performance/top-loader";

export default function TopLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasMountedRef = useRef(false);
  const route = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;

  const handleRouteReady = useEffectEvent((nextRoute: string) => {
    bumpTopLoaderForRouteCommit(nextRoute);
    completeTopLoader(nextRoute);
  });

  const handleDocumentClick = useEffectEvent((event: MouseEvent) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest("a");

    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    if (!shouldStartProgressForAnchorClick(anchor, event)) {
      return;
    }

    startTopLoaderForHref(anchor.href);
  });

  const handlePopState = useEffectEvent(() => {
    startTopLoader();
  });

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    handleRouteReady(route);
  }, [route]);

  useEffect(() => {
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return null;
}
