import { useState, useEffect, useCallback } from "react";

export function useSortedData<T>(
  data: T[],
  sortFn: (a: T, b: T, order: "asc" | "desc") => number,
) {
  const [sortedData, setSortedData] = useState<T[]>(data);

  useEffect(() => {
    setSortedData(data);
  }, [data]);

  const handleSort = useCallback(
    (order: "asc" | "desc") => {
      setSortedData((prev) => [...prev].sort((a, b) => sortFn(a, b, order)));
    },
    [sortFn],
  );

  return { sortedData, setSortedData, handleSort };
}
