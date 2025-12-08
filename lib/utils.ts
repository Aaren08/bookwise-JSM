import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getInitials = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "";

  return trimmed
    .split(/\s+/)
    .map((word) => word[0].toUpperCase())
    .join("")
    .slice(0, 2);
};
