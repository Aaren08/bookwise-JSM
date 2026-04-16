"use client";

import { createContext, useContext, useMemo, useState, ReactNode } from "react";

interface SearchContextType {
  query: string;
  setQuery: (q: string) => void;
  sortOrder: "asc" | "desc";
  setSortOrder: (order: "asc" | "desc") => void;
}

const SearchContext = createContext<SearchContextType>({
  query: "",
  setQuery: () => {},
  sortOrder: "asc",
  setSortOrder: () => {},
});

export const SearchProvider = ({ children }: { children: ReactNode }) => {
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const value = useMemo(
    () => ({ query, setQuery, sortOrder, setSortOrder }),
    [query, sortOrder],
  );

  return (
    <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
  );
};

export const useSearch = () => useContext(SearchContext);
