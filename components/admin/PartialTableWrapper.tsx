/**
 * Optimized table wrapper for partial skeleton loading
 *
 * Architecture:
 * 1. Table header is ALWAYS visible (instant visual feedback)
 * 2. Table body content swaps between old data and new data
 * 3. Skeleton rows only appear during the first load or data fetch
 * 4. Previous page data remains visible during pagination transitions
 *
 * Benefits:
 * - No layout shift or visual flashing
 * - Better perceived performance
 * - Reduced skeleton DOM weight (only rows, not full table)
 * - Previous data remains visible during transitions
 */

import { ReactNode, Suspense } from "react";
import { RowSkeleton } from "./skeleton/RowSkeleton";

type ColumnType =
  | "text"
  | "avatar-text"
  | "image-text"
  | "badge"
  | "date"
  | "actions"
  | "button";

interface PartialTableWrapperProps {
  children: ReactNode;
  columns: ColumnType[];
  skeletonRows?: number;
  header: ReactNode;
  title: string;
  filterSlot?: ReactNode;
}

/**
 * Wraps table with partial skeleton loading
 * Header stays visible, only rows are swapped during loading
 *
 * Usage:
 * ```tsx
 * <PartialTableWrapper
 *   columns={["image-text", "text", "badge", "date", "actions"]}
 *   header={<BookTableHeader />}
 *   title="All Books"
 *   filterSlot={<FilterData label="A-Z" />}
 * >
 *   <BooksTableBody page={page} />
 * </PartialTableWrapper>
 * ```
 */
export const PartialTableWrapper = ({
  children,
  columns,
  skeletonRows = 3,
  header,
  title,
  filterSlot,
}: PartialTableWrapperProps) => {
  return (
    <section className="w-full rounded-2xl bg-white p-7 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-dark-400">{title}</h2>
        {filterSlot && (
          <div className="flex flex-wrap items-center gap-2">{filterSlot}</div>
        )}
      </div>
      <div className="mt-7 table-scroll-container">
        <table className="w-full min-w-max table-auto text-left">
          {/* Header always visible - no suspense */}
          {header}

          {/* Body with partial skeleton loading */}
          <Suspense
            fallback={
              <tbody>
                <RowSkeleton columns={columns} rows={skeletonRows} />
              </tbody>
            }
          >
            {children}
          </Suspense>
        </table>
      </div>
    </section>
  );
};
