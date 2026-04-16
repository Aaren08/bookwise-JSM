"use client";

import {
  ComponentPropsWithoutRef,
  memo,
  useCallback,
  useRef,
  type TouchEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PrefetchOnIntentLinkProps = ComponentPropsWithoutRef<typeof Link>;

const PrefetchOnIntentLinkComponent = ({
  onMouseEnter,
  onFocus,
  onTouchStart,
  prefetch,
  href,
  ...props
}: PrefetchOnIntentLinkProps) => {
  const router = useRouter();
  const hasPrefetchedRef = useRef(false);

  const prefetchOnIntent = useCallback(() => {
    if (hasPrefetchedRef.current || typeof href !== "string") {
      return;
    }

    router.prefetch(href);
    hasPrefetchedRef.current = true;
  }, [href, router]);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      prefetchOnIntent();
      onMouseEnter?.(event);
    },
    [onMouseEnter, prefetchOnIntent],
  );

  const handleFocus = useCallback(
    (event: React.FocusEvent<HTMLAnchorElement>) => {
      prefetchOnIntent();
      onFocus?.(event);
    },
    [onFocus, prefetchOnIntent],
  );

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLAnchorElement>) => {
      prefetchOnIntent();
      onTouchStart?.(event);
    },
    [onTouchStart, prefetchOnIntent],
  );

  return (
    <Link
      href={href}
      prefetch={prefetch ?? true}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
      onTouchStart={handleTouchStart}
      {...props}
    />
  );
};

export const PrefetchOnIntentLink = memo(PrefetchOnIntentLinkComponent);
