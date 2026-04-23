"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, LoaderCircle } from "lucide-react";
import { memo, useState, useMemo, useEffect, useCallback } from "react";
import dayjs from "dayjs";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useSortedData } from "@/lib/admin/essentials/useSortedData";
import { showSuccessToast, showErrorToast } from "@/lib/essentials/toast-utils";
import { useSearch } from "@/components/admin/context/SearchContext";
import UserCell from "../shared/UserCell";
import TableRow from "../shared/TableRow";
import GenerateReceipt from "../GenerateReceipt";
import EmptySearch from "../shared/EmptySearch";
import { includes } from "@/lib/utils";

interface Props {
  borrowRecords: BorrowRecord[];
}

type BorrowStatus =
  | "PENDING"
  | "BORROWED"
  | "RETURNED"
  | "LATE_RETURN"
  | "REJECTED";

/* human-readable status labels for search matching */
const STATUS_LABELS: Record<BorrowStatus, string> = {
  PENDING: "pending",
  BORROWED: "borrowed",
  RETURNED: "returned",
  LATE_RETURN: "late return",
  REJECTED: "rejected",
};

const STATUS_OPTIONS: Array<{ value: BorrowStatus; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "BORROWED", label: "Borrowed" },
  { value: "RETURNED", label: "Returned" },
  { value: "LATE_RETURN", label: "Late Return" },
  { value: "REJECTED", label: "Rejected" },
];

const getStatusClasses = (status: BorrowStatus) =>
  cn(
    "h-8 w-[140px] rounded-full border-none px-3 text-xs font-semibold shadow-sm focus:ring-0",
    status === "PENDING" && "bg-orange-100 text-orange-600",
    status === "BORROWED" && "bg-violet-200 text-violet-600",
    status === "RETURNED" && "bg-green-100 text-green-600",
    status === "LATE_RETURN" && "bg-red-100 text-red-600",
    status === "REJECTED" && "bg-gray-100 text-gray-600",
  );

const getAllowedStatuses = (status: BorrowStatus): BorrowStatus[] => {
  switch (status) {
    case "PENDING":
      return ["PENDING", "BORROWED", "REJECTED"];
    case "BORROWED":
      return ["BORROWED", "RETURNED", "LATE_RETURN"];
    case "RETURNED":
      return ["RETURNED"];
    case "LATE_RETURN":
      return ["LATE_RETURN"];
    case "REJECTED":
      return ["REJECTED"];
    default:
      return [status];
  }
};

const resolveStatusEndpoint = (
  recordId: string,
  currentStatus: BorrowStatus,
  nextStatus: BorrowStatus,
) => {
  if (currentStatus === nextStatus) {
    return null;
  }

  if (currentStatus === "PENDING" && nextStatus === "BORROWED") {
    return `/api/book/requests/${recordId}/approve`;
  }

  if (currentStatus === "PENDING" && nextStatus === "REJECTED") {
    return `/api/book/requests/${recordId}/reject`;
  }

  if (
    currentStatus === "BORROWED" &&
    (nextStatus === "RETURNED" || nextStatus === "LATE_RETURN")
  ) {
    return `/api/book/requests/${recordId}/return`;
  }

  return null;
};

const getOptimisticStatus = (record: BorrowRecord, nextStatus: BorrowStatus) => {
  if (record.status !== "BORROWED" || nextStatus !== "RETURNED") {
    return nextStatus;
  }

  return dayjs().isAfter(dayjs(record.dueDate), "day")
    ? "LATE_RETURN"
    : "RETURNED";
};

const BorrowTableRow = memo(function BorrowTableRow({
  record,
  isUpdating,
  onStatusChange,
}: {
  record: BorrowRecord;
  isUpdating: boolean;
  onStatusChange: (record: BorrowRecord, nextStatus: BorrowStatus) => void;
}) {
  const allowedStatuses = getAllowedStatuses(record.status);

  return (
    <TableRow>
      <td className="py-4 pr-4 max-sm:pr-6">
        <div className="flex items-center gap-3">
          {record.bookCover ? (
            <Image
              src={record.bookCover}
              alt={record.bookTitle}
              width={40}
              height={60}
              style={{ width: "auto", height: "auto" }}
              className="rounded-sm object-cover"
            />
          ) : (
            <div className="h-[60px] w-[40px] bg-gray-200 rounded-sm" />
          )}
          <p className="font-semibold text-dark-400 line-clamp-1 max-w-[200px]">
            {record.bookTitle}
          </p>
        </div>
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <UserCell
          fullName={record.userFullName}
          email={record.userEmail}
          image={record.userAvatar}
        />
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <Select
          value={record.status}
          onValueChange={(value: BorrowStatus) => onStatusChange(record, value)}
          disabled={isUpdating}
        >
          <SelectTrigger
            aria-busy={isUpdating}
            className={cn(getStatusClasses(record.status), isUpdating && "opacity-80")}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <SelectValue />
              {isUpdating && (
                <LoaderCircle className="size-3 shrink-0 animate-spin" />
              )}
            </div>
          </SelectTrigger>
          <SelectContent align="end" className="bg-white">
            {STATUS_OPTIONS.filter((option) =>
              allowedStatuses.includes(option.value),
            ).map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="cursor-pointer text-sm font-medium focus:bg-light-300"
              >
                <div className="flex items-center gap-2">
                  <span>{option.label}</span>
                  {record.status === option.value && (
                    <Check className="size-3 text-green-500" />
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {record.status === "PENDING"
          ? "-"
          : dayjs(record.borrowDate).format("MMM DD YYYY")}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {record.returnDate ? dayjs(record.returnDate).format("MMM DD YYYY") : "-"}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {record.status === "PENDING" ? "-" : dayjs(record.dueDate).format("MMM DD YYYY")}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <GenerateReceipt borrowRecordId={record.id} status={record.status} />
      </td>
    </TableRow>
  );
});

const BorrowTable = ({ borrowRecords }: Props) => {
  const { query, sortOrder } = useSearch();

  const sortFn = useCallback(
    (a: BorrowRecord, b: BorrowRecord, order: "asc" | "desc") => {
      return order === "desc"
        ? new Date(a.borrowDate).getTime() - new Date(b.borrowDate).getTime()
        : new Date(b.borrowDate).getTime() - new Date(a.borrowDate).getTime();
    },
    [],
  );

  const {
    sortedData: sortedRecords,
    setSortedData: setSortedRecords,
    handleSort,
  } = useSortedData(borrowRecords, sortFn);

  useEffect(() => {
    handleSort(sortOrder);
  }, [sortOrder, handleSort]);

  /* filtered view */
  const filteredRecords = useMemo(() => {
    if (!query.trim()) return sortedRecords;
    return sortedRecords.filter(
      (r) =>
        includes(r.bookTitle, query) ||
        includes(r.userFullName, query) ||
        includes(r.userEmail, query) ||
        includes(STATUS_LABELS[r.status], query),
    );
  }, [sortedRecords, query]);

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const handleStatusChange = useCallback(
    async (record: BorrowRecord, newStatus: BorrowStatus) => {
      const endpoint = resolveStatusEndpoint(record.id, record.status, newStatus);

      if (!endpoint) {
        if (record.status !== newStatus) {
          showErrorToast("Invalid status transition");
        }
        return;
      }

      const previousRecord = record;
      const optimisticStatus = getOptimisticStatus(record, newStatus);
      const optimisticReturnDate =
        optimisticStatus === "RETURNED" || optimisticStatus === "LATE_RETURN"
          ? dayjs().format("YYYY-MM-DD")
          : null;

      setPendingIds((prev) => new Set(prev).add(record.id));
      setSortedRecords((prev) =>
        prev.map((item) =>
          item.id === record.id
            ? {
                ...item,
                status: optimisticStatus,
                returnDate: optimisticReturnDate,
              }
            : item,
        ),
      );

      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          cache: "no-store",
        });
        const result = await res.json();

        if (res.ok && result.success) {
          const confirmedStatus = (result.data?.status || optimisticStatus) as BorrowStatus;
          const confirmedReturnDate =
            result.data?.returnDate ??
            (confirmedStatus === "RETURNED" || confirmedStatus === "LATE_RETURN"
              ? optimisticReturnDate
              : null);

          showSuccessToast(`Status updated to ${confirmedStatus}`);
          setSortedRecords((prev) =>
            prev.map((item) =>
              item.id === record.id
                ? {
                    ...item,
                    status: confirmedStatus,
                    returnDate: confirmedReturnDate,
                  }
                : item,
            ),
          );
        } else {
          setSortedRecords((prev) =>
            prev.map((item) => (item.id === record.id ? previousRecord : item)),
          );
          showErrorToast(result.error || result.message || "Failed to update status");
        }
      } catch (error) {
        setSortedRecords((prev) =>
          prev.map((item) => (item.id === record.id ? previousRecord : item)),
        );
        console.error(error);
        showErrorToast("Failed to update borrow status");
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(record.id);
          return next;
        });
      }
    },
    [setSortedRecords],
  );

  return (
    <>
      <tbody>
        {filteredRecords.length === 0 && query.trim() ? (
          <EmptySearch query={query} entity="borrow records" colSpan={7} />
        ) : (
          filteredRecords.map((record) => (
            <BorrowTableRow
              key={record.id}
              record={record}
              isUpdating={pendingIds.has(record.id)}
              onStatusChange={handleStatusChange}
            />
          ))
        )}
      </tbody>
    </>
  );
};

export default BorrowTable;
