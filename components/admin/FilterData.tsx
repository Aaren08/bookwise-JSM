"use client";

import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { useState } from "react";

interface Props {
  onSort: (value: "asc" | "desc") => void;
  label?: string;
}

const FilterData = ({ onSort, label = "A-Z" }: Props) => {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const toggleSort = () => {
    const newOrder = sortOrder === "asc" ? "desc" : "asc";
    setSortOrder(newOrder);
    onSort(newOrder);
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={toggleSort} className="sort-btn">
        {label}
        {sortOrder === "asc" ? (
          <ArrowDownAZ className="size-4" />
        ) : (
          <ArrowUpAZ className="size-4" />
        )}
      </button>
    </div>
  );
};

export default FilterData;
