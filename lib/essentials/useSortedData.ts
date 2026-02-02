import { useState, useEffect } from "react";

export function useSortedData<T>(
  data: T[],
  sortFn: (a: T, b: T, order: "asc" | "desc") => number,
) {
  const [sortedData, setSortedData] = useState<T[]>(data);

  useEffect(() => {
    setSortedData(data);
  }, [data]);

  const handleSort = (order: "asc" | "desc") => {
    const sorted = [...sortedData].sort((a, b) => sortFn(a, b, order));
    setSortedData(sorted);
  };

  return { sortedData, setSortedData, handleSort };
}
