/**
 * Optimized server action wrapper for table data fetching
 *
 * Benefits:
 * - Single data fetch shared between table and pagination
 * - Prevents duplicate API calls
 * - Enables keeping previous data visible during transitions
 * - Type-safe result handling
 */

export interface PaginatedResult<T> {
  success: boolean;
  data?: {
    items: T[];
    totalPages: number;
    totalCount: number;
    currentPage: number;
  };
  message?: string;
}

/**
 * Wrapper to consolidate table data fetching
 * Used by parent Server Components to fetch once and distribute data
 *
 * Usage in parent page:
 * ```tsx
 * const result = await fetchTableData({ page, action: getAllBooks });
 * return {
 *   data: result.data?.items || [],
 *   totalPages: result.data?.totalPages || 0,
 * };
 * ```
 */
export const createCachedTableFetch = <T, P extends Record<string, unknown>>(
  fetchFn: (params: P) => Promise<PaginatedResult<T>>,
) => {
  return async (params: P): Promise<PaginatedResult<T>> => {
    try {
      const result = await fetchFn(params);
      return result;
    } catch (error) {
      console.error("Table data fetch failed:", error);
      return {
        success: false,
        message: "Failed to fetch data",
      };
    }
  };
};

/**
 * Hook for using shared table data in child components
 * Prevents passing data props through multiple levels
 */
export const useTableData = <T>(data: T[], isLoading?: boolean) => {
  return {
    data,
    isLoading: isLoading ?? false,
    isEmpty: data.length === 0,
  };
};
