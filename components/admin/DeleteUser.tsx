"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteUser } from "@/lib/admin/actions/user";
import { useState } from "react";
import Image from "next/image";
import { showErrorToast, showSuccessToast } from "@/lib/essentials/toast-utils";

interface DeleteUserProps {
  userId: string;
  expectedVersion: number;
  onDelete?: () => void;
  onAcquireLock: () => Promise<boolean>;
  onReleaseLock: () => Promise<void>;
  lockToken?: string;
  disabled?: boolean;
}

const DeleteUser = ({
  userId,
  expectedVersion,
  onDelete,
  onAcquireLock,
  onReleaseLock,
  lockToken,
  disabled = false,
}: DeleteUserProps) => {
  const [open, setOpen] = useState(false);

  const handleOpenChange = async (nextOpen: boolean) => {
    if (nextOpen) {
      if (disabled) return;
      const acquired = await onAcquireLock();
      if (!acquired) return;
      setOpen(true);
      return;
    }

    setOpen(false);
    await onReleaseLock();
  };

  const handleDelete = async () => {
    const res = await deleteUser({ userId, expectedVersion, lockToken });
    if (res.success) {
      setOpen(false);
      showSuccessToast("User deleted successfully");
      onDelete?.();
    } else {
      showErrorToast(res.error || "Failed to delete user");
    }

    await onReleaseLock();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <button
          aria-label="Delete user"
          className="cursor-pointer text-red-500 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          <Image
            src="/icons/admin/trash.svg"
            alt="trash"
            width={20}
            height={20}
          />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the user
            account and remove their data from our servers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer bg-dark-300 text-white hover:bg-dark-200 ">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
            className="cursor-pointer bg-red-500 text-white hover:bg-red-600"
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteUser;
