"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import dayjs from "dayjs";
import { getInitials } from "@/lib/utils";
import { updateBorrowStatus } from "@/lib/admin/actions/borrow";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import FilterData from "./FilterData";
import GenerateReceipt from "./GenerateReceipt";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface Props {
  borrowRecords: BorrowRecord[];
}

const BorrowTable = ({ borrowRecords }: Props) => {
  const [sortedRecords, setSortedRecords] =
    useState<BorrowRecord[]>(borrowRecords);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setSortedRecords(borrowRecords);
  }, [borrowRecords]);

  const handleSort = (order: "asc" | "desc") => {
    const sorted = [...sortedRecords].sort((a, b) => {
      if (order === "asc") {
        return (
          new Date(a.borrowDate).getTime() - new Date(b.borrowDate).getTime()
        );
      } else {
        return (
          new Date(b.borrowDate).getTime() - new Date(a.borrowDate).getTime()
        );
      }
    });
    setSortedRecords(sorted);
  };

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
        toast.success("Borrow status updated successfully", {
          position: "top-right",
          style: {
            background: "#dcfce7",
            color: "#000000",
            border: "1px solid #86efac",
          },
          className: "!bg-green-200 !text-black",
        });
        setSortedRecords(
          sortedRecords.map((record) =>
            record.id === recordId ? { ...record, status: newStatus } : record,
          ),
        );
      } else {
        toast.error(res.message || "Failed to update borrow status", {
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <section className="w-full rounded-2xl bg-white p-7 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-dark-400">
          Borrow Book Requests
        </h2>
        <FilterData onSort={handleSort} label="Oldest to Recent" />
      </div>

      <div className="mt-7 w-full overflow-x-auto">
        <table className="w-full min-w-max table-auto text-left">
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
              <tr
                key={record.id}
                className="border-b border-light-400 last:border-0 hover:bg-light-300/50 transition-colors"
              >
                <td className="py-4 pr-4">
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
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-light-100 font-bold text-dark-100">
                        {getInitials(record.userFullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <p className="font-semibold text-dark-400">
                        {record.userFullName}
                      </p>
                      <p className="text-xs text-light-500">
                        {record.userEmail}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="py-4 pr-4">
                  <Select
                    defaultValue="PENDING"
                    value={record.status}
                    onValueChange={(
                      value:
                        | "PENDING"
                        | "BORROWED"
                        | "RETURNED"
                        | "LATE_RETURN",
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
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {record.status === "PENDING"
                    ? "-"
                    : dayjs(record.borrowDate).format("MMM DD YYYY")}
                </td>
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {record.returnDate
                    ? dayjs(record.returnDate).format("MMM DD YYYY")
                    : "-"}
                </td>
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {record.status === "PENDING"
                    ? "-"
                    : dayjs(record.dueDate).format("MMM DD YYYY")}
                </td>
                <td className="py-4 pr-4">
                  <GenerateReceipt
                    borrowRecordId={record.id}
                    status={record.status}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default BorrowTable;
