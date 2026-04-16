"use client";

import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { useState } from "react";
import { useSearch } from "@/components/admin/context/SearchContext";

interface Props {
  onSort?: (value: "asc" | "desc") => void;
  label?: string;
}

const FilterData = ({ onSort, label = "A-Z" }: Props) => {
  const { sortOrder, setSortOrder } = useSearch();
  const [localSortOrder, setLocalSortOrder] = useState<"asc" | "desc">("asc");

  const toggleSort = () => {
    const newOrder = sortOrder === "asc" ? "desc" : "asc";
    setSortOrder(newOrder);
    setLocalSortOrder(newOrder);
    if (onSort) {
      onSort(newOrder);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={toggleSort} className="sort-btn">
        {label}
        {localSortOrder === "asc" ? (
          <ArrowDownAZ className="size-4" />
        ) : (
          <ArrowUpAZ className="size-4" />
        )}
      </button>
    </div>
  );
};

export default FilterData;
