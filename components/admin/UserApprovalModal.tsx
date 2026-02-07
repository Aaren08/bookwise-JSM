"use client";

import Image from "next/image";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "approve" | "deny";
  onConfirm: () => void;
}

const UserApprovalModal = ({ open, onOpenChange, type, onConfirm }: Props) => {
  const isApprove = type === "approve";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-white p-8 max-w-[400px] flex flex-col items-center text-center gap-6">
        <div className="absolute top-4 right-4">
          <AlertDialogCancel
            className="border-none p-0 h-auto hover:bg-transparent cursor-pointer shadow-none"
            onClick={() => onOpenChange(false)}
          >
            <Image
              src="/icons/admin/close.svg"
              alt="close"
              width={15}
              height={15}
            />
          </AlertDialogCancel>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Image
            src={
              isApprove
                ? "/icons/admin/approve-user.svg"
                : "/icons/admin/deny-user.svg"
            }
            alt={isApprove ? "Approve User" : "Deny User"}
            width={100}
            height={100}
          />
        </div>

        <AlertDialogHeader className="flex flex-col items-center gap-2 w-full">
          <AlertDialogTitle className="text-xl font-bold text-dark-400">
            {isApprove ? "Approve Account Request" : "Deny Account Request"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center text-light-500 text-sm leading-relaxed">
            {isApprove
              ? "Approve the student's account request and grant access. A confirmation email will be sent upon approval."
              : "Denying this request will notify the student they're not eligible due to unsuccessful ID card verification."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="w-full flex-col sm:flex-col gap-0">
          <AlertDialogAction
            onClick={onConfirm}
            className={`w-full cursor-pointer h-14 rounded-md font-semibold text-white transition-colors ${
              isApprove
                ? "bg-[#4c7b62] hover:bg-[#3d6350]"
                : "bg-[#f46f70] hover:bg-[#d85c5d]"
            }`}
          >
            {isApprove
              ? "Approve & Send Confirmation"
              : "Deny & Notify Student"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default UserApprovalModal;
