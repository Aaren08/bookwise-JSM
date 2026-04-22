"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
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

/* human-readable status labels for search matching */
const STATUS_LABELS: Record<string, string> = {
  PENDING: "pending",
  BORROWED: "borrowed",
  RETURNED: "returned",
  LATE_RETURN: "late return",
  REJECTED: "rejected",
};

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
        includes(STATUS_LABELS[r.status] ?? r.status, query),
    );
  }, [sortedRecords, query]);

  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (
    recordId: string,
    newStatus: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED",
  ) => {
    setIsUpdating(true);
    try {
      let endpoint = "";
      if (newStatus === "BORROWED") endpoint = `/api/requests/${recordId}/approve`;
      else if (newStatus === "REJECTED") endpoint = `/api/requests/${recordId}/reject`;
      else if (newStatus === "RETURNED" || newStatus === "LATE_RETURN") endpoint = `/api/requests/${recordId}/return`;

      if (!endpoint) {
        showErrorToast("Invalid status transition");
        return;
      }

      const res = await fetch(endpoint, { method: "PATCH" });
      const result = await res.json();

      if (res.ok && result.success) {
        showSuccessToast(`Status updated to ${newStatus}`);
        setSortedRecords(
          sortedRecords.map((record) =>
            record.id === recordId ? { ...record, status: newStatus } : record,
          ),
        );
      } else {
        showErrorToast(result.error || result.message || "Failed to update status");
      }
    } catch (error) {
      console.error(error);
      showErrorToast("Failed to update borrow status");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <tbody>
        {filteredRecords.length === 0 && query.trim() ? (
          <EmptySearch query={query} entity="borrow records" colSpan={7} />
        ) : (
          filteredRecords.map((record) => (
            <TableRow key={record.id}>
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
                  defaultValue="PENDING"
                  value={record.status}
                  onValueChange={(
                    value: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED",
                  ) => handleStatusChange(record.id, value)}
                  disabled={isUpdating}
                >
                  <SelectTrigger
                    className={cn(
                      "h-8 w-[140px] rounded-full border-none px-3 text-xs font-semibold shadow-sm focus:ring-0",
                      record.status === "PENDING" &&
                        "bg-orange-100 text-orange-600",
                      record.status === "BORROWED" &&
                        "bg-violet-200 text-violet-600",
                      record.status === "RETURNED" &&
                        "bg-green-100 text-green-600",
                      record.status === "LATE_RETURN" &&
                        "bg-red-100 text-red-600",
                      record.status === "REJECTED" &&
                        "bg-gray-100 text-gray-600",
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" className="bg-white">
                    <SelectItem
                      value="PENDING"
                      className="cursor-pointer text-sm font-medium focus:bg-light-300"
                    >
                      <div className="flex items-center gap-2">
                        <span>Pending</span>
                        {record.status === "PENDING" && (
                          <Check className="size-3 text-green-500" />
                        )}
                      </div>
                    </SelectItem>
                    <SelectItem
                      value="BORROWED"
                      className="cursor-pointer text-sm font-medium focus:bg-light-300"
                    >
                      <div className="flex items-center gap-2">
                        <span>Borrowed</span>
                        {record.status === "BORROWED" && (
                          <Check className="size-3 text-green-500" />
                        )}
                      </div>
                    </SelectItem>
                    <SelectItem
                      value="RETURNED"
                      className="cursor-pointer text-sm font-medium focus:bg-light-300"
                    >
                      <div className="flex items-center gap-2">
                        <span>Returned</span>
                        {record.status === "RETURNED" && (
                          <Check className="size-3 text-green-500" />
                        )}
                      </div>
                    </SelectItem>
                    <SelectItem
                      value="LATE_RETURN"
                      className="cursor-pointer text-sm font-medium focus:bg-light-300"
                    >
                      <div className="flex items-center gap-2">
                        <span>Late Return</span>
                        {record.status === "LATE_RETURN" && (
                          <Check className="size-3 text-green-500" />
                        )}
                      </div>
                    </SelectItem>
                    <SelectItem
                      value="REJECTED"
                      className="cursor-pointer text-sm font-medium focus:bg-light-300"
                    >
                      <div className="flex items-center gap-2">
                        <span>Rejected</span>
                        {record.status === "REJECTED" && (
                          <Check className="size-3 text-green-500" />
                        )}
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
                {record.status === "PENDING"
                  ? "-"
                  : dayjs(record.borrowDate).format("MMM DD YYYY")}
              </td>
              <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
                {record.returnDate
                  ? dayjs(record.returnDate).format("MMM DD YYYY")
                  : "-"}
              </td>
              <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
                {record.status === "PENDING"
                  ? "-"
                  : dayjs(record.dueDate).format("MMM DD YYYY")}
              </td>
              <td className="py-4 pr-4 max-sm:pr-6">
                <GenerateReceipt
                  borrowRecordId={record.id}
                  status={record.status}
                />
              </td>
            </TableRow>
          ))
        )}
      </tbody>
    </>
  );
};

export default BorrowTable;
