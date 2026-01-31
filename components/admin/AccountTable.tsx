"use client";

import { useState, useEffect } from "react";
import { CircleX } from "lucide-react";
import { toast } from "sonner";
import dayjs from "dayjs";
import Image from "next/image";
import { getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ViewUserCard from "./ViewUserCard";
import UserApprovalModal from "./UserApprovalModal";
import FilterData from "./FilterData";
import { approveAccount, rejectAccount } from "@/lib/admin/actions/user";

interface Props {
  users: PendingUser[];
}

const AccountTable = ({ users }: Props) => {
  const [sortedUsers, setSortedUsers] = useState<PendingUser[]>(users);
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);

  const [isCardOpen, setIsCardOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"approve" | "deny">("approve");

  useEffect(() => {
    setSortedUsers(users);
  }, [users]);

  const handleSort = (order: "asc" | "desc") => {
    const sorted = [...sortedUsers].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();

      if (order === "asc") {
        return dateA - dateB;
      } else {
        return dateB - dateA;
      }
    });
    setSortedUsers(sorted);
  };

  const handleViewCard = (user: PendingUser) => {
    setSelectedUser(user);
    setIsCardOpen(true);
  };

  const handleApprove = (userId: string) => {
    const user = sortedUsers.find((u) => u.id === userId);
    if (user) {
      setSelectedUser(user);
      setModalType("approve");
      setIsModalOpen(true);
    }
  };

  const handleReject = (userId: string) => {
    const user = sortedUsers.find((u) => u.id === userId);
    if (user) {
      setSelectedUser(user);
      setModalType("deny");
      setIsModalOpen(true);
    }
  };

  const handleModalConfirm = async () => {
    if (!selectedUser) return;

    if (modalType === "approve") {
      const res = await approveAccount(selectedUser.id);
      if (res.success) {
        toast.success("Account approved successfully", {
          position: "top-right",
          style: {
            background: "#dcfce7",
            color: "#000000",
            border: "1px solid #86efac",
          },
          className: "!bg-green-200 !text-black",
        });
        setSortedUsers(
          sortedUsers.filter((user) => user.id !== selectedUser.id),
        );
      } else {
        toast.error(res.error || "Failed to approve account", {
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
      }
    } else {
      const res = await rejectAccount(selectedUser.id);
      if (res.success) {
        toast.success("Account rejected successfully", {
          position: "top-right",
          style: {
            background: "#dcfce7",
            color: "#000000",
            border: "1px solid #86efac",
          },
          className: "!bg-green-200 !text-black",
        });
        setSortedUsers(
          sortedUsers.filter((user) => user.id !== selectedUser.id),
        );
      } else {
        toast.error(res.error || "Failed to reject account", {
          position: "top-right",
          style: {
            background: "#fee2e2",
            color: "#000000",
            border: "1px solid #fca5a5",
          },
          className: "!bg-red-200 !text-black",
        });
      }
    }
    setIsModalOpen(false);
  };

  return (
    <section className="w-full rounded-2xl bg-white p-7 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-dark-400">
          Account Registration Requests
        </h2>
        <FilterData onSort={handleSort} label="Oldest to Recent" />
      </div>

      <div className="mt-7 w-full overflow-x-auto">
        <table className="w-full min-w-max table-auto text-left">
          <thead className="h-14 bg-blue-50">
            <tr>
              <th className="header-cell">Name</th>
              <th className="header-cell">Date Joined</th>
              <th className="header-cell">University ID No</th>
              <th className="header-cell">University ID Card</th>
              <th className="header-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((user) => (
              <tr
                key={user.id}
                className="border-b border-light-400 last:border-0 hover:bg-light-300/50 transition-colors"
              >
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-light-100 font-bold text-dark-100">
                        {getInitials(user.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <p className="font-semibold text-dark-400">
                        {user.fullName}
                      </p>
                      <p className="text-xs text-light-500">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 pr-12 text-sm text-dark-400">
                  {dayjs(user.createdAt).format("MMM DD YYYY")}
                </td>
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {user.universityId}
                </td>
                <td className="py-4 pr-12">
                  <button
                    onClick={() => handleViewCard(user)}
                    className="cursor-pointer flex items-center gap-1 text-sm font-semibold text-blue-500 hover:text-blue-600"
                  >
                    View ID Card
                    <Image
                      src="/icons/admin/link.svg"
                      alt="link"
                      width={18}
                      height={18}
                    />
                  </button>
                </td>
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApprove(user.id)}
                      className="approve-account-btn"
                    >
                      Approve Account
                    </button>
                    <button
                      onClick={() => handleReject(user.id)}
                      className="rounded-full p-2 text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                      aria-label="Reject account"
                    >
                      <CircleX className="size-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedUser && (
        <ViewUserCard
          isOpen={isCardOpen}
          onClose={() => setIsCardOpen(false)}
          universityCard={selectedUser.universityCard}
          fullName={selectedUser.fullName}
          universityId={selectedUser.universityId}
        />
      )}

      {selectedUser && (
        <UserApprovalModal
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          type={modalType}
          onConfirm={handleModalConfirm}
        />
      )}
    </section>
  );
};

export default AccountTable;
