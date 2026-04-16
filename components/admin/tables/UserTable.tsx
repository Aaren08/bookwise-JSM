"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { useState, useMemo, memo, useCallback, useEffect } from "react";
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

interface Props {
  users: User[];
}

// Memoized row component
const UserRowComponent = memo(
  ({
    user,
    onRoleChange,
    onViewCard,
    onDelete,
  }: {
    user: User;
    onRoleChange: (userId: string, newRole: "USER" | "ADMIN") => Promise<void>;
    onViewCard: (user: User) => void;
    onDelete: (userId: string) => void;
  }) => (
    <TableRow>
      <td className="py-4 pr-4 max-sm:pr-6">
        <UserCell
          fullName={user.fullName}
          email={user.email}
          image={user.userAvatar}
        />
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {dayjs(user.createdAt).format("MMM DD YYYY")}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <Select
          value={user.role}
          onValueChange={(value: "USER" | "ADMIN") =>
            onRoleChange(user.id, value)
          }
        >
          <SelectTrigger className="h-8 w-[100px] rounded-full border-none bg-light-300 px-3 text-xs font-semibold text-dark-400 shadow-sm focus:ring-0">
            <SelectValue />
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
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400 pl-5">
        {user.booksBorrowed || 0}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
        {user.universityId}
      </td>
      <td className="py-4 pr-4 max-sm:pr-6">
        <ViewCardButton onClick={() => onViewCard(user)} />
      </td>
      <td className="py-4 pr-4 max-sm:pr-6 pl-3">
        <DeleteUser userId={user.id} onDelete={() => onDelete(user.id)} />
      </td>
    </TableRow>
  ),
);

UserRowComponent.displayName = "UserRow";

const UserTable = ({ users }: Props) => {
  const { query, sortOrder } = useSearch();

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

  useEffect(() => {
    handleSort(sortOrder);
  }, [sortOrder, handleSort]);

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

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isCardOpen, setIsCardOpen] = useState(false);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: "USER" | "ADMIN") => {
      const res = await updateUserRole(userId, newRole);
      if (res.success) {
        showSuccessToast("User role updated successfully");
        setSortedUsers((prev) =>
          prev.map((user) =>
            user.id === userId ? { ...user, role: newRole } : user,
          ),
        );
      } else {
        showErrorToast(res.error || "Failed to update user role");
      }
    },
    [setSortedUsers],
  );

  const handleViewCard = useCallback((user: User) => {
    setSelectedUser(user);
    setIsCardOpen(true);
  }, []);

  const handleDelete = useCallback(
    (userId: string) => {
      setSortedUsers((prev) => prev.filter((u) => u.id !== userId));
    },
    [setSortedUsers],
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
              onRoleChange={handleRoleChange}
              onViewCard={handleViewCard}
              onDelete={handleDelete}
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
