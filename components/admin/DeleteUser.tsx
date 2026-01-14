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
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  userId: string;
  onDelete: () => void;
}

const DeleteUser = ({ userId, onDelete }: Props) => {
  const handleDelete = async (userId: string) => {
    const res = await deleteUser(userId);
    if (res.success) {
      toast.success("User deleted successfully", {
        position: "top-right",
        style: {
          background: "#dcfce7",
          color: "#000000",
          border: "1px solid #86efac",
        },
        className: "!bg-green-200 !text-black",
      });
      onDelete();
    } else {
      toast.error(res.error || "Failed to delete user", {
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

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="cursor-pointer text-red-500 hover:text-red-600 transition-colors">
          <Trash2 className="size-5" />
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
            onClick={() => handleDelete(userId)}
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
