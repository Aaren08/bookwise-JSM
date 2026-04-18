"use client";

import { startTransition, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  buildSearchHref,
  SearchRouteFilter,
} from "@/lib/performance/navigation";
import { navigateWithTopLoader } from "@/lib/performance/top-loader";

interface SearchFilterProps {
  currentFilter: SearchRouteFilter;
  query?: string;
}

const SearchFilter = ({ currentFilter, query = "" }: SearchFilterProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const baseParams = useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(baseParams);

      if (query.trim()) {
        params.set("query", query.trim());
      }

      params.set("filter", value);
      params.delete("page");

      startTransition(() => {
        navigateWithTopLoader(
          router,
          "replace",
          buildSearchHref({
            query: params.get("query") || "",
            filter: value as SearchRouteFilter,
          }),
          { scroll: false },
        );
      });
    },
    [baseParams, query, router],
  );

  const getDisplayValue = () => {
    return currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1);
  };

  return (
    <Select value={currentFilter} onValueChange={handleFilterChange}>
      <SelectTrigger className="select-trigger">
        <span className="text-light-100 text-sm">Filter by:</span>
        <SelectValue className="text-primary font-semibold">
          {getDisplayValue()}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="select-content">
        <SelectItem value="author" className="select-item text-primary">
          Author
        </SelectItem>
        <SelectItem value="genre" className="select-item text-primary">
          Genre
        </SelectItem>
        <SelectItem value="rating" className="select-item text-primary">
          Rating
        </SelectItem>
        <SelectItem value="availability" className="select-item text-primary">
          Availability
        </SelectItem>
      </SelectContent>
    </Select>
  );
};

export default SearchFilter;
