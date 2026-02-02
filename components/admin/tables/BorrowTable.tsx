"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { useState } from "react";
import dayjs from "dayjs";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { updateBorrowStatus } from "@/lib/admin/actions/borrow";
import { useSortedData } from "@/lib/essentials/useSortedData";
import { showSuccessToast, showErrorToast } from "@/lib/essentials/toast-utils";
import UserCell from "../shared/UserCell";
import TableContainer from "../shared/TableContainer";
import TableRow from "../shared/TableRow";
import GenerateReceipt from "../GenerateReceipt";

interface Props {
  borrowRecords: BorrowRecord[];
}

const BorrowTable = ({ borrowRecords }: Props) => {
  const {
    sortedData: sortedRecords,
    setSortedData: setSortedRecords,
    handleSort,
  } = useSortedData(borrowRecords, (a, b, order) => {
    return order === "asc"
      ? new Date(a.borrowDate).getTime() - new Date(b.borrowDate).getTime()
      : new Date(b.borrowDate).getTime() - new Date(a.borrowDate).getTime();
  });

  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (
    recordId: string,
    newStatus: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN",
  ) => {
    setIsUpdating(true);
    try {
      const res = await updateBorrowStatus({
        bookId: recordId,
        status: newStatus,
      });
      if (res.success) {
        showSuccessToast("Borrow status updated successfully");
        setSortedRecords(
          sortedRecords.map((record) =>
            record.id === recordId ? { ...record, status: newStatus } : record,
          ),
        );
      } else {
        showErrorToast(res.message || "Failed to update borrow status");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <TableContainer
      title="Borrow Book Requests"
      onSort={handleSort}
      filterLabel="Oldest to Recent"
    >
      <thead className="h-14 bg-blue-50">
        <tr>
          <th className="header-cell">Book</th>
          <th className="header-cell">User Requested</th>
          <th className="header-cell">Status</th>
          <th className="header-cell">Borrowed Date</th>
          <th className="header-cell">Return Date</th>
          <th className="header-cell">Due Date</th>
          <th className="header-cell">Receipt</th>
        </tr>
      </thead>
      <tbody>
        {sortedRecords.map((record) => (
          <TableRow key={record.id}>
            <td className="py-4 pr-4 max-sm:pr-6">
              <div className="flex items-center gap-3">
                {record.bookCover ? (
                  <Image
                    src={record.bookCover}
                    alt={record.bookTitle}
                    width={40}
                    height={60}
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
                  value: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN",
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
        ))}
      </tbody>
    </TableContainer>
  );
};

export default BorrowTable;
