"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, LoaderCircle } from "lucide-react";
import { useState, useMemo, memo, useCallback, useEffect, useRef } from "react";
import dayjs from "dayjs";
import { updateUserRole } from "@/lib/admin/actions/user";
import { useSortedData } from "@/lib/admin/essentials/useSortedData";
import { showSuccessToast, showErrorToast } from "@/lib/essentials/toast-utils";
import { useSearch } from "@/components/admin/context/SearchContext";
import UserCell from "../shared/UserCell";
import TableRow from "../shared/TableRow";
import ViewCardButton from "../shared/ViewCardButton";
import ViewUserCard from "../ViewUserCard";
import DeleteUser from "../DeleteUser";
import EmptySearch from "../shared/EmptySearch";
import { includes } from "@/lib/utils";
import RowLockIndicator from "../shared/RowLockIndicator";
import { useRowLock } from "@/lib/admin/realtime/concurrency/useRowLock";
import { useRealtimeUpdates } from "@/lib/admin/realtime/concurrency/useRealtimeUpdates";
import { useOptimisticUpdate } from "@/lib/admin/realtime/concurrency/useOptimisticUpdate";
import type { AdminRowLock } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

interface Props {
  users: User[];
  currentAdmin: AdminActor;
}

const UserRowComponent = memo(
  ({
    user,
    isUpdating,
    isLocked,
    lock,
    onOpenChange,
    onRoleChange,
    onViewCard,
    onDelete,
    onAcquireDeleteLock,
    onReleaseDeleteLock,
  }: {
    user: User;
    isUpdating: boolean;
    isLocked: boolean;
    lock: AdminRowLock | null;
    onOpenChange: (user: User, open: boolean) => void;
    onRoleChange: (user: User, newRole: "USER" | "ADMIN") => Promise<void>;
    onViewCard: (user: User) => void;
    onDelete: (userId: string) => void;
    onAcquireDeleteLock: (user: User) => Promise<boolean>;
    onReleaseDeleteLock: (user: User) => Promise<void>;
  }) => (
    <TableRow>
      <td className="py-4 pr-4 max-sm:pr-6">
        <UserCell
          fullName={user.fullName}
          email={user.email}
          image={user.userAvatar}
        />
      </td>
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {dayjs(user.createdAt).format("MMM DD YYYY")}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <Select
          value={user.role}
          onOpenChange={(open) => onOpenChange(user, open)}
          onValueChange={(value: "USER" | "ADMIN") => onRoleChange(user, value)}
          disabled={isUpdating || isLocked}
        >
          <SelectTrigger className="h-8 w-[100px] rounded-full border-none bg-light-300 px-3 text-xs font-semibold text-dark-400 shadow-sm focus:ring-0">
            <div className="flex items-center gap-2">
              <SelectValue />
              {isUpdating && <LoaderCircle className="size-3 animate-spin" />}
            </div>
          </SelectTrigger>
          <SelectContent align="end" className="bg-white">
            <SelectItem
              value="USER"
              className="cursor-pointer text-sm font-medium focus:bg-light-300"
            >
              <div className="flex items-center gap-2">
                <span>User</span>
                {user.role === "USER" && (
                  <Check className="size-3 text-green-500" />
                )}
              </div>
            </SelectItem>
            <SelectItem
              value="ADMIN"
              className="cursor-pointer text-sm font-medium focus:bg-light-300"
            >
              <div className="flex items-center gap-2">
                <span>Admin</span>
                {user.role === "ADMIN" && (
                  <Check className="size-3 text-green-500" />
                )}
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="py-4 pr-4 pl-5 text-sm text-dark-400 max-sm:pr-6">
        {user.booksBorrowed || 0}
      </td>
      <td className="py-4 pr-4 text-sm text-dark-400 max-sm:pr-6">
        {user.universityId}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <ViewCardButton onClick={() => onViewCard(user)} />
      </td>
      <td className="relative py-4 pr-4 pl-3 max-sm:pr-6">
        <RowLockIndicator lock={lock} />
        <DeleteUser
          userId={user.id}
          expectedVersion={user.version}
          onDelete={() => onDelete(user.id)}
          onAcquireLock={() => onAcquireDeleteLock(user)}
          onReleaseLock={() => onReleaseDeleteLock(user)}
          lockToken={lock?.token}
          disabled={isLocked}
        />
      </td>
    </TableRow>
  ),
);

UserRowComponent.displayName = "UserRow";

const UserTable = ({ users, currentAdmin }: Props) => {
  const { query, sortOrder } = useSearch();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isCardOpen, setIsCardOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [pinnedRowId, setPinnedRowId] = useState<string | null>(null);

  const sortFn = useCallback((a: User, b: User, order: "asc" | "desc") => {
    return order === "asc"
      ? a.fullName.localeCompare(b.fullName)
      : b.fullName.localeCompare(a.fullName);
  }, []);

  const {
    sortedData: sortedUsers,
    setSortedData: setSortedUsers,
    handleSort,
  } = useSortedData(users, sortFn);

  const { updateItem } = useOptimisticUpdate(setSortedUsers);

  const matchesFilter = useCallback(
    (user: User) =>
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
    entity: "users",
    items: sortedUsers,
    setItems: setSortedUsers,
    sortFn,
    sortOrder,
    pinnedRowId,
    matchesFilter,
  });

  const filteredUsers = useMemo(
    () => sortedUsers.filter(matchesFilter),
    [matchesFilter, sortedUsers],
  );

  const rowIds = useMemo(
    () => filteredUsers.map((user) => user.id),
    [filteredUsers],
  );

  const rowLock = useRowLock({
    entity: "users",
    rowIds,
    currentAdminId: currentAdmin.id,
  });

  const handleOpenChange = useCallback(
    async (user: User, open: boolean) => {
      if (open) {
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

        setPinnedRowId(user.id);
        return;
      }

      if (!pendingIdsRef.current.has(user.id)) {
        await rowLock.releaseRowLock(user.id);
        setPinnedRowId((current) => (current === user.id ? null : current));
      }
    },
    [rowLock],
  );

  const handleRoleChange = useCallback(
    async (user: User, newRole: "USER" | "ADMIN") => {
      if (pendingIdsRef.current.has(user.id)) return;

      let lockToken = rowLock.lockForRow(user.id)?.token;

      if (!rowLock.isLockedByCurrentAdmin(user.id)) {
        const result = await rowLock.acquireRowLock(user.id);
        if (!result.success) {
          showErrorToast(result.message || "Unable to lock row");
          return;
        }
        lockToken = result.lock?.token;
      }

      pendingIdsRef.current.add(user.id);
      setPendingIds(new Set(pendingIdsRef.current));
      setPinnedRowId(user.id);
      const previousUser = updateItem(user.id, (item) => ({
        ...item,
        role: newRole,
      }));

      try {
        const res = await updateUserRole({
          userId: user.id,
          role: newRole,
          expectedVersion: user.version,
          lockToken,
        });
        if (res.success && res.data) {
          showSuccessToast("User role updated successfully");
          updateItem(user.id, () => res.data as User);
        } else {
          if (previousUser) updateItem(user.id, () => previousUser);
          showErrorToast(res.error || "Failed to update user role");
        }
      } catch (error) {
        if (previousUser) updateItem(user.id, () => previousUser);
        showErrorToast(
          error instanceof Error
            ? error.message
            : "An error occurred while updating user role",
        );
        console.error(error);
      } finally {
        pendingIdsRef.current.delete(user.id);
        setPendingIds(new Set(pendingIdsRef.current));
        await rowLock.releaseRowLock(user.id);
        setPinnedRowId((current) => (current === user.id ? null : current));
      }
    },
    [rowLock, updateItem],
  );

  const handleViewCard = useCallback((user: User) => {
    setSelectedUser(user);
    setIsCardOpen(true);
  }, []);

  const handleDelete = useCallback(
    (userId: string) => {
      setSortedUsers((prev) => prev.filter((user) => user.id !== userId));
    },
    [setSortedUsers],
  );

  const onAcquireDeleteLock = useCallback(
    async (user: User) => {
      if (rowLock.isLockedByOther(user.id)) {
        const lock = rowLock.lockForRow(user.id);
        showErrorToast(
          lock ? `Row locked by ${lock.adminName}` : "Row is locked",
        );
        return false;
      }

      if (rowLock.isLockedByCurrentAdmin(user.id)) {
        setPinnedRowId(user.id);
        return true;
      }

      const result = await rowLock.acquireRowLock(user.id);
      if (!result.success) {
        showErrorToast(result.message || "Unable to lock row");
        return false;
      }

      setPinnedRowId(user.id);
      return true;
    },
    [rowLock],
  );

  const onReleaseDeleteLock = useCallback(
    async (user: User) => {
      await rowLock.releaseRowLock(user.id);
      setPinnedRowId((current) => (current === user.id ? null : current));
    },
    [rowLock],
  );

  return (
    <>
      <tbody>
        {filteredUsers.length === 0 && query.trim() ? (
          <EmptySearch query={query} entity="users" colSpan={7} />
        ) : (
          filteredUsers.map((user) => (
            <UserRowComponent
              key={user.id}
              user={user}
              isUpdating={pendingIds.has(user.id)}
              isLocked={rowLock.isLockedByOther(user.id)}
              lock={rowLock.lockForRow(user.id)}
              onOpenChange={handleOpenChange}
              onRoleChange={handleRoleChange}
              onViewCard={handleViewCard}
              onDelete={handleDelete}
              onAcquireDeleteLock={onAcquireDeleteLock}
              onReleaseDeleteLock={onReleaseDeleteLock}
            />
          ))
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
    </>
  );
};

export default UserTable;
