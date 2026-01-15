"use client";

import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { useState } from "react";

interface Props {
  onSort: (value: "asc" | "desc") => void;
}

const FilterData = ({ onSort }: Props) => {
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const toggleSort = () => {
    const newOrder = sortOrder === "asc" ? "desc" : "asc";
    setSortOrder(newOrder);
    onSort(newOrder);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleSort}
        className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-admin/50"
      >
        A-Z
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
