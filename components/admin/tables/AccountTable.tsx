"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { CircleX } from "lucide-react";
import dayjs from "dayjs";
import { approveAccount, rejectAccount } from "@/lib/admin/actions/user";
import { useSortedData } from "@/lib/admin/essentials/useSortedData";
import { showSuccessToast, showErrorToast } from "@/lib/essentials/toast-utils";
import { useSearch } from "@/components/admin/context/SearchContext";
import UserCell from "../shared/UserCell";
import TableRow from "../shared/TableRow";
import ViewCardButton from "../shared/ViewCardButton";
import ViewUserCard from "../ViewUserCard";
import UserApprovalModal from "../UserApprovalModal";
import EmptySearch from "../shared/EmptySearch";
import { includes } from "@/lib/utils";
import { useRowLock } from "@/lib/admin/realtime/concurrency/useRowLock";
import { useRealtimeUpdates } from "@/lib/admin/realtime/concurrency/useRealtimeUpdates";
import { useOptimisticUpdate } from "@/lib/admin/realtime/concurrency/useOptimisticUpdate";
import RowLockIndicator from "../shared/RowLockIndicator";

interface Props {
  users: PendingUser[];
  currentAdmin: AdminActor;
}

const AccountTable = ({ users, currentAdmin }: Props) => {
  const { query, sortOrder } = useSearch();
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);
  const [isCardOpen, setIsCardOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"approve" | "deny">("approve");
  const [pinnedRowId, setPinnedRowId] = useState<string | null>(null);

  const sortFn = useCallback(
    (a: PendingUser, b: PendingUser, order: "asc" | "desc") => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return order === "asc" ? dateA - dateB : dateB - dateA;
    },
    [],
  );

  const {
    sortedData: sortedUsers,
    setSortedData: setSortedUsers,
    handleSort,
  } = useSortedData(users, sortFn);

  const { removeItem, restoreItem } = useOptimisticUpdate(setSortedUsers);

  const matchesFilter = useCallback(
    (user: PendingUser) =>
      !query.trim() ||
      includes(user.fullName, query) ||
      includes(user.email, query) ||
      includes(user.universityId, query),
    [query],
  );

  useEffect(() => {
    handleSort(sortOrder);
  }, [sortOrder, handleSort]);

  useRealtimeUpdates({
    entity: "account_requests",
    setItems: setSortedUsers,
    sortFn,
    sortOrder,
    pinnedRowId,
    matchesFilter,
  });

  const rowIds = useMemo(
    () => sortedUsers.map((user) => user.id),
    [sortedUsers],
  );
  const rowLock = useRowLock({
    entity: "account_requests",
    rowIds,
    currentAdminId: currentAdmin.id,
  });

  const filteredUsers = useMemo(
    () => sortedUsers.filter(matchesFilter),
    [matchesFilter, sortedUsers],
  );

  const handleViewCard = (user: PendingUser) => {
    setSelectedUser(user);
    setIsCardOpen(true);
  };

  const startModeration = useCallback(
    async (user: PendingUser, type: "approve" | "deny") => {
      if (rowLock.isLockedByOther(user.id)) {
        const lock = rowLock.lockForRow(user.id);
        showErrorToast(
          lock ? `Row locked by ${lock.adminName}` : "Row is locked",
        );
        return;
      }

      if (!rowLock.isLockedByCurrentAdmin(user.id)) {
        const result = await rowLock.acquireRowLock(user.id);
        if (!result.success) {
          showErrorToast(result.message || "Unable to lock row");
          return;
        }
      }

      setSelectedUser(user);
      setModalType(type);
      setPinnedRowId(user.id);
      setIsModalOpen(true);
    },
    [rowLock],
  );

  const handleModalOpenChange = useCallback(
    async (open: boolean) => {
      setIsModalOpen(open);

      if (!open && selectedUser) {
        await rowLock.releaseRowLock(selectedUser.id);
        setPinnedRowId((current) =>
          current === selectedUser.id ? null : current,
        );
      }
    },
    [rowLock, selectedUser],
  );

  const handleModalConfirm = useCallback(async () => {
    if (!selectedUser) return;

    const originalIndex = sortedUsers.findIndex(
      (user) => user.id === selectedUser.id,
    );
    const removedUser = removeItem(selectedUser.id);

    try {
      if (modalType === "approve") {
        const res = await approveAccount({
          userId: selectedUser.id,
          expectedVersion: selectedUser.version,
          lockToken: rowLock.lockForRow(selectedUser.id)?.token,
        });
        if (res.success) {
          showSuccessToast("Account approved successfully");
        } else {
          if (removedUser) restoreItem(removedUser, originalIndex);
          showErrorToast(res.error || "Failed to approve account");
        }
      } else {
        const res = await rejectAccount({
          userId: selectedUser.id,
          expectedVersion: selectedUser.version,
          lockToken: rowLock.lockForRow(selectedUser.id)?.token,
        });
        if (res.success) {
          showSuccessToast("Account rejected successfully");
        } else {
          if (removedUser) restoreItem(removedUser, originalIndex);
          showErrorToast(res.error || "Failed to reject account");
        }
      }
    } catch (error) {
      if (removedUser) restoreItem(removedUser, originalIndex);
      console.error("Account approval/rejection failed:", error);
      showErrorToast("Failed to process account request");
    } finally {
      setIsModalOpen(false);
      await rowLock.releaseRowLock(selectedUser.id);
      setPinnedRowId((current) =>
        current === selectedUser.id ? null : current,
      );
    }
  }, [modalType, removeItem, restoreItem, rowLock, selectedUser, sortedUsers]);

  return (
    <>
      <tbody>
        {filteredUsers.length === 0 && query.trim() ? (
          <EmptySearch query={query} entity="accounts" colSpan={5} />
        ) : (
          filteredUsers.map((user) => {
            const lockedByOther = rowLock.isLockedByOther(user.id);

            return (
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
                <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
                  {user.universityId}
                </td>
                <td className="py-4 pr-12">
                  <ViewCardButton onClick={() => handleViewCard(user)} />
                </td>
                <td className="relative py-4 pr-4 max-sm:pr-6">
                  <RowLockIndicator lock={rowLock.lockForRow(user.id)} />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void startModeration(user, "approve")}
                      className="approve-account-btn disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={lockedByOther}
                    >
                      Approve Account
                    </button>
                    <button
                      onClick={() => void startModeration(user, "deny")}
                      className="reject-account-btn disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Reject account"
                      disabled={lockedByOther}
                    >
                      <CircleX className="size-5" />
                    </button>
                  </div>
                </td>
              </TableRow>
            );
          })
        )}
      </tbody>

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
          onOpenChange={(open) => void handleModalOpenChange(open)}
          type={modalType}
          onConfirm={() => void handleModalConfirm()}
        />
      )}
    </>
  );
};

export default AccountTable;
