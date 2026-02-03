"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useSearch } from "@/components/admin/context/SearchContext";

/*  route → placeholder map  */
const ROUTE_PLACEHOLDERS: Record<string, string> = {
  "/admin/users": "Search users by name, email, or ID…",
  "/admin/books": "Search books by title, author, or genre…",
  "/admin/borrow-records": "Search by book title, user, or status…",
  "/admin/account-requests": "Search pending accounts by name or ID…",
};

const DEFAULT_PLACEHOLDER = "Search users, books by title, author, or genre…";

/* helper: pick the best matching route key  */
function getPlaceholder(pathname: string): string {
  // exact match first
  if (ROUTE_PLACEHOLDERS[pathname]) return ROUTE_PLACEHOLDERS[pathname];

  // prefix match (e.g. /admin/books/[id]/edit still highlights "books")
  for (const route of Object.keys(ROUTE_PLACEHOLDERS)) {
    if (pathname.startsWith(route)) return ROUTE_PLACEHOLDERS[route];
  }

  return DEFAULT_PLACEHOLDER;
}

const AdminSearch = () => {
  const pathname = usePathname();
  const { query, setQuery } = useSearch();
  const [search, setSearch] = useState(query);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setQuery(search);
    }, 700);

    return () => clearTimeout(delayDebounceFn);
  }, [search, setQuery]);

  useEffect(() => {
    setSearch(query);
  }, [query]);

  return (
    <div className="admin-search">
      <Image
        src="/icons/admin/search.svg"
        alt="search"
        width={20}
        height={20}
        className="shrink-0"
      />
      <input
        type="text"
        className="admin-search_input"
        placeholder={getPlaceholder(pathname)}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search"
      />
    </div>
  );
};

export default AdminSearch;
