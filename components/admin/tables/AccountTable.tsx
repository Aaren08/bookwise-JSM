"use client";

import { useState, useMemo } from "react";
import { CircleX } from "lucide-react";
import dayjs from "dayjs";
import { approveAccount, rejectAccount } from "@/lib/admin/actions/user";
import { useSortedData } from "@/lib/essentials/useSortedData";
import { showSuccessToast, showErrorToast } from "@/lib/essentials/toast-utils";
import { useSearch } from "@/components/admin/context/SearchContext";
import UserCell from "../shared/UserCell";
import TableContainer from "../shared/TableContainer";
import TableRow from "../shared/TableRow";
import ViewCardButton from "../shared/ViewCardButton";
import ViewUserCard from "../ViewUserCard";
import UserApprovalModal from "../UserApprovalModal";
import EmptySearch from "../shared/EmptySearch";
import { includes } from "@/lib/utils";

interface Props {
  users: PendingUser[];
}

const AccountTable = ({ users }: Props) => {
  const { query } = useSearch();

  const {
    sortedData: sortedUsers,
    setSortedData: setSortedUsers,
    handleSort,
  } = useSortedData(users, (a, b, order) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return order === "asc" ? dateA - dateB : dateB - dateA;
  });

  /* filtered view */
  const filteredUsers = useMemo(() => {
    if (!query.trim()) return sortedUsers;
    return sortedUsers.filter(
      (u) =>
        includes(u.fullName, query) ||
        includes(u.email, query) ||
        includes(u.universityId, query),
    );
  }, [sortedUsers, query]);

  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);
  const [isCardOpen, setIsCardOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"approve" | "deny">("approve");

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

    try {
      if (modalType === "approve") {
        const res = await approveAccount(selectedUser.id);
        if (res.success) {
          showSuccessToast("Account approved successfully");
          setSortedUsers((prev) =>
            prev.filter((user) => user.id !== selectedUser.id),
          );
        } else {
          showErrorToast(res.error || "Failed to approve account");
        }
      } else {
        const res = await rejectAccount(selectedUser.id);
        if (res.success) {
          showSuccessToast("Account rejected successfully");
          setSortedUsers((prev) =>
            prev.filter((user) => user.id !== selectedUser.id),
          );
        } else {
          showErrorToast(res.error || "Failed to reject account");
        }
      }
    } catch (error) {
      console.error("Account approval/rejection failed:", error);
      showErrorToast("Failed to process account request");
    } finally {
      setIsModalOpen(false);
    }
  };

  return (
    <>
      <TableContainer
        title="Account Registration Requests"
        onSort={handleSort}
        filterLabel="Oldest to Recent"
      >
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
          {filteredUsers.length === 0 && query.trim() ? (
            <EmptySearch query={query} entity="accounts" colSpan={5} />
          ) : (
            filteredUsers.map((user) => (
              <TableRow key={user.id}>
                <td className="py-4 pr-4 max-sm:pr-6">
                  <UserCell
                    fullName={user.fullName}
                    email={user.email}
                    image={user.userAvatar}
                  />
                </td>
                <td className="py-4 pr-12 text-sm text-dark-400">
                  {dayjs(user.createdAt).format("MMM DD YYYY")}
                </td>
                <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
                  {user.universityId}
                </td>
                <td className="py-4 pr-12">
                  <ViewCardButton onClick={() => handleViewCard(user)} />
                </td>
                <td className="py-4 pr-4 max-sm:pr-6">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApprove(user.id)}
                      className="approve-account-btn"
                    >
                      Approve Account
                    </button>
                    <button
                      onClick={() => handleReject(user.id)}
                      className="reject-account-btn"
                      aria-label="Reject account"
                    >
                      <CircleX className="size-5" />
                    </button>
                  </div>
                </td>
              </TableRow>
            ))
          )}
        </tbody>
      </TableContainer>

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
    </>
  );
};

export default AccountTable;
