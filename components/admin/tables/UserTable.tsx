"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { useState, useMemo } from "react";
import dayjs from "dayjs";
import { updateUserRole } from "@/lib/admin/actions/user";
import { useSortedData } from "@/lib/essentials/useSortedData";
import { showSuccessToast, showErrorToast } from "@/lib/essentials/toast-utils";
import { useSearch } from "@/components/admin/context/SearchContext";
import UserCell from "../shared/UserCell";
import TableContainer from "../shared/TableContainer";
import TableRow from "../shared/TableRow";
import ViewCardButton from "../shared/ViewCardButton";
import ViewUserCard from "../ViewUserCard";
import DeleteUser from "../DeleteUser";
import EmptySearch from "../shared/EmptySearch";
import { includes } from "@/lib/utils";

interface Props {
  users: User[];
}

const UserTable = ({ users }: Props) => {
  const { query } = useSearch();

  const {
    sortedData: sortedUsers,
    setSortedData: setSortedUsers,
    handleSort,
  } = useSortedData(users, (a, b, order) => {
    return order === "asc"
      ? a.fullName.localeCompare(b.fullName)
      : b.fullName.localeCompare(a.fullName);
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

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isCardOpen, setIsCardOpen] = useState(false);

  const handleRoleChange = async (
    userId: string,
    newRole: "USER" | "ADMIN",
  ) => {
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
  };

  const handleViewCard = (user: User) => {
    setSelectedUser(user);
    setIsCardOpen(true);
  };

  return (
    <>
      <TableContainer title="All Users" onSort={handleSort}>
        <thead className="h-14 bg-blue-50">
          <tr>
            <th className="header-cell">Name</th>
            <th className="header-cell">Date Joined</th>
            <th className="header-cell">Role</th>
            <th className="header-cell">Books Borrowed</th>
            <th className="header-cell">University ID No</th>
            <th className="header-cell">University ID Card</th>
            <th className="header-cell">Action</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.length === 0 && query.trim() ? (
            <EmptySearch query={query} entity="users" colSpan={7} />
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
                <td className="py-4 pr-4 max-sm:pr-6 text-sm text-dark-400">
                  {dayjs(user.createdAt).format("MMM DD YYYY")}
                </td>
                <td className="py-4 pr-4 max-sm:pr-6">
                  <Select
                    value={user.role}
                    onValueChange={(value: "USER" | "ADMIN") =>
                      handleRoleChange(user.id, value)
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
                  <ViewCardButton onClick={() => handleViewCard(user)} />
                </td>
                <td className="py-4 pr-4 max-sm:pr-6 pl-3">
                  <DeleteUser
                    userId={user.id}
                    onDelete={() =>
                      setSortedUsers((prev) =>
                        prev.filter((u) => u.id !== user.id),
                      )
                    }
                  />
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
    </>
  );
};

export default UserTable;
