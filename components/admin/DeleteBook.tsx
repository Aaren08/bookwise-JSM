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
  onDelete?: () => void;
}

const DeleteBook = ({ id, onDelete }: Props) => {
  const [open, setOpen] = useState(false);

  const handleDelete = async (id: string) => {
    const res = await deleteBook(id);
    if (res.success) {
      setOpen(false);
      showSuccessToast("Book deleted successfully");
      onDelete?.();
    } else {
      showErrorToast(res.message || "Failed to delete book");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <div className="cursor-pointer">
          <Image
            src="/icons/admin/trash.svg"
            alt="delete"
            width={24}
            height={24}
          />
        </div>
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
            onClick={(e) => {
              e.preventDefault();
              handleDelete(id);
            }}
            className="cursor-pointer bg-blue-500 hover:bg-blue-600 text-white"
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteBook;
