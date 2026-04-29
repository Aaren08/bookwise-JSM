"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, LoaderCircle } from "lucide-react";
import { memo, useState, useMemo, useEffect, useCallback, useRef } from "react";
import dayjs from "dayjs";
import Image from "next/image";
import { cn, includes } from "@/lib/utils";
import { useSortedData } from "@/lib/admin/essentials/useSortedData";
import { showSuccessToast, showErrorToast } from "@/lib/essentials/toast-utils";
import { useSearch } from "@/components/admin/context/SearchContext";
import UserCell from "../shared/UserCell";
import TableRow from "../shared/TableRow";
import GenerateReceipt from "../GenerateReceipt";
import EmptySearch from "../shared/EmptySearch";
import RowLockIndicator from "../shared/RowLockIndicator";
import { useRowLock } from "@/lib/admin/realtime/concurrency/useRowLock";
import { useRealtimeUpdates } from "@/lib/admin/realtime/concurrency/useRealtimeUpdates";
import { useOptimisticUpdate } from "@/lib/admin/realtime/concurrency/useOptimisticUpdate";
import type { AdminRowLock } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

interface Props {
  borrowRecords: BorrowRecord[];
  currentAdmin: AdminActor;
}

type BorrowStatus = BorrowRecord["status"];

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

const getOptimisticStatus = (
  record: BorrowRecord,
  nextStatus: BorrowStatus,
) => {
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
  isLocked,
  lock,
  onOpenChange,
  onStatusChange,
}: {
  record: BorrowRecord;
  isUpdating: boolean;
  isLocked: boolean;
  lock: AdminRowLock | null;
  onOpenChange: (record: BorrowRecord, open: boolean) => void;
  onStatusChange: (record: BorrowRecord, nextStatus: BorrowStatus) => void;
}) {
  const allowedStatuses = getAllowedStatuses(record.status);

  return (
    <TableRow className={isUpdating ? "z-10" : undefined}>
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
            <div className="h-[60px] w-[40px] rounded-sm bg-gray-200" />
          )}
          <p className="line-clamp-1 max-w-[200px] font-semibold text-dark-400">
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
          onOpenChange={(open) => onOpenChange(record, open)}
          onValueChange={(value: BorrowStatus) => onStatusChange(record, value)}
          disabled={isUpdating || isLocked}
        >
          <SelectTrigger
            aria-busy={isUpdating}
            className={cn(
              getStatusClasses(record.status),
              isUpdating && "opacity-80",
            )}
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
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {record.status === "PENDING"
          ? "-"
          : dayjs(record.borrowDate).format("MMM DD YYYY")}
      </td>
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {record.returnDate
          ? dayjs(record.returnDate).format("MMM DD YYYY")
          : "-"}
      </td>
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {record.status === "PENDING"
          ? "-"
          : dayjs(record.dueDate).format("MMM DD YYYY")}
      </td>
      <td className="relative py-4 pr-4 max-sm:pr-6">
        <RowLockIndicator lock={lock} />
        <GenerateReceipt borrowRecordId={record.id} status={record.status} />
      </td>
    </TableRow>
  );
});

const BorrowTable = ({ borrowRecords, currentAdmin }: Props) => {
  const { query, sortOrder } = useSearch();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [pinnedRowId, setPinnedRowId] = useState<string | null>(null);

  const sortFn = useCallback(
    (a: BorrowRecord, b: BorrowRecord, order: "asc" | "desc") =>
      order === "desc"
        ? new Date(a.borrowDate).getTime() - new Date(b.borrowDate).getTime()
        : new Date(b.borrowDate).getTime() - new Date(a.borrowDate).getTime(),
    [],
  );

  const {
    sortedData: sortedRecords,
    setSortedData: setSortedRecords,
    handleSort,
  } = useSortedData(borrowRecords, sortFn);

  const { updateItem } = useOptimisticUpdate(setSortedRecords);

  const matchesFilter = useCallback(
    (record: BorrowRecord) =>
      !query.trim() ||
      includes(record.bookTitle, query) ||
      includes(record.userFullName, query) ||
      includes(record.userEmail, query) ||
      includes(STATUS_LABELS[record.status], query),
    [query],
  );

  useEffect(() => {
    handleSort(sortOrder);
  }, [sortOrder, handleSort]);

  useRealtimeUpdates({
    entity: "borrow_requests",
    setItems: setSortedRecords,
    sortFn,
    sortOrder,
    pinnedRowId,
    matchesFilter,
  });

  const rowIds = useMemo(
    () => sortedRecords.map((record) => record.id),
    [sortedRecords],
  );
  const rowLock = useRowLock({
    entity: "borrow_requests",
    rowIds,
    currentAdminId: currentAdmin.id,
  });

  const filteredRecords = useMemo(
    () => sortedRecords.filter(matchesFilter),
    [matchesFilter, sortedRecords],
  );

  const handleOpenChange = useCallback(
    async (record: BorrowRecord, open: boolean) => {
      if (open) {
        if (rowLock.isLockedByOther(record.id)) {
          const lock = rowLock.lockForRow(record.id);
          showErrorToast(
            lock ? `Row locked by ${lock.adminName}` : "Row is locked",
          );
          return;
        }

        if (!rowLock.isLockedByCurrentAdmin(record.id)) {
          const result = await rowLock.acquireRowLock(record.id);
          if (!result.success) {
            showErrorToast(result.message || "Unable to lock row");
            return;
          }
        }

        setPinnedRowId(record.id);
        return;
      }

      if (
        !pendingIdsRef.current.has(record.id) &&
        rowLock.isLockedByCurrentAdmin(record.id)
      ) {
        await rowLock.releaseRowLock(record.id);
        setPinnedRowId((current) => (current === record.id ? null : current));
      }
    },
    [rowLock],
  );

  const handleStatusChange = useCallback(
    async (record: BorrowRecord, newStatus: BorrowStatus) => {
      if (pendingIdsRef.current.has(record.id)) return;

      const endpoint = resolveStatusEndpoint(
        record.id,
        record.status,
        newStatus,
      );

      if (!endpoint) {
        if (record.status !== newStatus) {
          showErrorToast("Invalid status transition");
        }
        return;
      }

      if (!rowLock.isLockedByCurrentAdmin(record.id)) {
        const lockResult = await rowLock.acquireRowLock(record.id);
        if (!lockResult.success) {
          showErrorToast(lockResult.message || "Unable to lock row");
          return;
        }
      }

      const optimisticStatus = getOptimisticStatus(record, newStatus);
      const optimisticReturnDate =
        optimisticStatus === "RETURNED" || optimisticStatus === "LATE_RETURN"
          ? dayjs().format("YYYY-MM-DD")
          : null;

      setPinnedRowId(record.id);
      pendingIdsRef.current.add(record.id);
      setPendingIds(new Set(pendingIdsRef.current));
      const previousRecord = updateItem(record.id, (item) => ({
        ...item,
        status: optimisticStatus,
        returnDate: optimisticReturnDate,
      }));

      try {
        const response = await fetch(endpoint, {
          method: "PATCH",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expectedVersion: record.version,
            lockToken: rowLock.lockForRow(record.id)?.token,
          }),
        });
        const result = await response.json();

        if (response.ok && result.success && result.data) {
          showSuccessToast(`Status updated to ${result.data.status}`);
          updateItem(record.id, () => result.data as BorrowRecord);
        } else {
          if (previousRecord) {
            updateItem(record.id, () => previousRecord);
          }
          showErrorToast(
            result.error || result.message || "Failed to update status",
          );
        }
      } catch (error) {
        if (previousRecord) {
          updateItem(record.id, () => previousRecord);
        }
        console.error(error);
        showErrorToast("Failed to update borrow status");
      } finally {
        pendingIdsRef.current.delete(record.id);
        setPendingIds(new Set(pendingIdsRef.current));
        await rowLock.releaseRowLock(record.id);
        setPinnedRowId((current) => (current === record.id ? null : current));
      }
    },
    [rowLock, updateItem],
  );

  return (
    <tbody>
      {filteredRecords.length === 0 && query.trim() ? (
        <EmptySearch query={query} entity="borrow records" colSpan={7} />
      ) : (
        filteredRecords.map((record) => (
          <BorrowTableRow
            key={record.id}
            record={record}
            isUpdating={pendingIds.has(record.id)}
            isLocked={rowLock.isLockedByOther(record.id)}
            lock={rowLock.lockForRow(record.id)}
            onOpenChange={handleOpenChange}
            onStatusChange={handleStatusChange}
          />
        ))
      )}
    </tbody>
  );
};

export default BorrowTable;
