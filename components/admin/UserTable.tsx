"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import dayjs from "dayjs";
import { getInitials } from "@/lib/utils";
import { updateUserRole } from "@/lib/admin/actions/user";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ViewUserCard from "./ViewUserCard";
import UserFilter from "./UserFilter";
import DeleteUser from "./DeleteUser";

interface Props {
  users: User[];
}

const UserTable = ({ users }: Props) => {
  const [sortedUsers, setSortedUsers] = useState<User[]>(users);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isCardOpen, setIsCardOpen] = useState(false);

  const handleSort = (order: "asc" | "desc") => {
    const sorted = [...sortedUsers].sort((a, b) => {
      if (order === "asc") {
        return a.fullName.localeCompare(b.fullName);
      } else {
        return b.fullName.localeCompare(a.fullName);
      }
    });
    setSortedUsers(sorted);
  };

  const handleRoleChange = async (
    userId: string,
    newRole: "USER" | "ADMIN"
  ) => {
    const res = await updateUserRole(userId, newRole);
    if (res.success) {
      toast.success("User role updated successfully", {
        position: "top-right",
        style: {
          background: "#dcfce7",
          color: "#000000",
          border: "1px solid #86efac",
        },
        className: "!bg-green-200 !text-black",
      });
      setSortedUsers(
        sortedUsers.map((user) =>
          user.id === userId ? { ...user, role: newRole } : user
        )
      );
    } else {
      toast.error(res.error || "Failed to update user role", {
        position: "top-right",
        style: {
          background: "#fee2e2",
          color: "#000000",
          border: "1px solid #fca5a5",
        },
        className: "!bg-red-200 !text-black",
      });
    }
  };

  const handleViewCard = (user: User) => {
    setSelectedUser(user);
    setIsCardOpen(true);
  };

  return (
    <section className="w-full rounded-2xl bg-white p-7 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-dark-400">All Users</h2>
        <UserFilter onSort={handleSort} />
      </div>

      <div className="mt-7 w-full overflow-x-auto">
        <table className="w-full min-w-max table-auto text-left">
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
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {dayjs(user.createdAt).format("MMM DD YYYY")}
                </td>
                <td className="py-4 pr-4">
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
                <td className="py-4 pr-4 text-sm text-dark-400 pl-5">
                  {user.booksBorrowed || 0}
                </td>
                <td className="py-4 pr-4 text-sm text-dark-400">
                  {user.universityId}
                </td>
                <td className="py-4 pr-4">
                  <button
                    onClick={() => handleViewCard(user)}
                    className=" cursor-pointer flex items-center gap-1 text-sm font-semibold text-blue-500 hover:text-blue-600"
                  >
                    View ID Card
                    <ExternalLink className="size-4" />
                  </button>
                </td>
                <td className="py-4 pr-4 pl-3">
                  <DeleteUser
                    userId={user.id}
                    onDelete={() =>
                      setSortedUsers(
                        sortedUsers.filter((u) => u.id !== user.id)
                      )
                    }
                  />
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
    </section>
  );
};

export default UserTable;
