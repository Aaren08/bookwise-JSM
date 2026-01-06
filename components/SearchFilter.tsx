"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface SearchFilterProps {
  currentFilter: "author" | "genre" | "rating" | "availability";
}

const SearchFilter = ({ currentFilter }: SearchFilterProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleFilterChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("filter", value);
    params.delete("page"); // Reset to page 1 on filter change
    router.push(`/search?${params.toString()}`);
    router.refresh();
  };

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
