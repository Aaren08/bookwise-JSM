/**
 * Row-only skeleton for partial table loading
 * Shows only skeleton rows while table header remains visible
 * Reduces DOM weight and improves perceived performance
 */

type ColumnType =
  | "text"
  | "avatar-text"
  | "image-text"
  | "badge"
  | "date"
  | "actions"
  | "button";

interface RowSkeletonProps {
  columns: ColumnType[];
  rows?: number;
}

export const RowSkeleton = ({ columns, rows = 3 }: RowSkeletonProps) => {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={`skeleton-row-${i}`}>
          {columns.map((type, j) => (
            <td key={j} className="py-4 pr-4">
              <CellSkeleton type={type} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
};

const CellSkeleton = ({ type }: { type: ColumnType }) => {
  switch (type) {
    case "avatar-text":
      return (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-skeleton" />
          <div className="h-4 w-28 bg-skeleton rounded" />
        </div>
      );

    case "image-text":
      return (
        <div className="flex items-center gap-3">
          <div className="h-12 w-10 rounded bg-skeleton" />
          <div className="h-4 w-32 bg-skeleton rounded" />
        </div>
      );

    case "badge":
      return <div className="h-6 w-20 rounded-full bg-skeleton" />;

    case "date":
      return <div className="h-4 w-24 bg-skeleton rounded" />;

    case "actions":
      return (
        <div className="flex gap-2">
          <div className="h-8 w-8 bg-skeleton rounded" />
          <div className="h-8 w-8 bg-skeleton rounded" />
        </div>
      );

    case "button":
      return <div className="h-8 w-16 bg-skeleton rounded" />;

    default:
      return <div className="h-4 w-28 bg-skeleton rounded" />;
  }
};
