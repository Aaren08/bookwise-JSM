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
import { deleteBook } from "@/lib/admin/actions/book";
import Image from "next/image";
import { useState } from "react";
import { showErrorToast, showSuccessToast } from "@/lib/essentials/toast-utils";

interface Props {
  id: string;
  expectedVersion: number;
  onDelete?: () => void;
  onAcquireLock: () => Promise<boolean>;
  onReleaseLock: () => Promise<void>;
  lockToken?: string;
  disabled?: boolean;
}

const DeleteBook = ({
  id,
  expectedVersion,
  onDelete,
  onAcquireLock,
  onReleaseLock,
  lockToken,
  disabled = false,
}: Props) => {
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
    try {
      await onReleaseLock();
    } catch (error) {
      console.error("Failed to release lock on modal close:", error);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await deleteBook({ id, expectedVersion, lockToken });
      if (res.success) {
        setOpen(false);
        showSuccessToast("Book deleted successfully");
        onDelete?.();
      } else {
        showErrorToast(res.message || "Failed to delete book");
      }
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "Failed to delete book",
      );
    } finally {
      try {
        await onReleaseLock();
      } catch (error) {
        console.error("Failed to release lock on delete:", error);
      }
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          <Image
            src="/icons/admin/trash.svg"
            alt="delete"
            width={24}
            height={24}
          />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the book
            and remove its data from our servers.
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
            className="cursor-pointer bg-blue-500 text-white hover:bg-blue-600"
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteBook;
