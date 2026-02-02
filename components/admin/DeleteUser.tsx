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

interface Props {
  userId: string;
  onDelete: () => void;
}

const DeleteUser = ({ userId, onDelete }: Props) => {
  const [open, setOpen] = useState(false);

  const handleDelete = async (userId: string) => {
    const res = await deleteUser(userId);
    if (res.success) {
      setOpen(false);
      showSuccessToast("User deleted successfully");
      onDelete();
    } else {
      showErrorToast(res.error || "Failed to delete user");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          aria-label="Delete user"
          className="cursor-pointer text-red-500 hover:text-red-600 transition-colors"
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
            onClick={(e) => {
              e.preventDefault();
              handleDelete(userId);
            }}
            className="cursor-pointer bg-red-500 hover:bg-red-600 text-white"
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteUser;
