"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useEffect } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  universityCard: string;
  fullName: string;
  universityId: number;
}

const ViewUserCard = ({
  isOpen,
  onClose,
  universityCard,
  fullName,
  universityId,
}: Props) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-all"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white p-6 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full cursor-pointer bg-gray-100 p-2 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center gap-4">
          <h2 className="text-xl font-bold text-dark-400">
            University ID Card
          </h2>

          <div className="relative aspect-[1.586] w-full overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
            <Image
              src={universityCard}
              alt={`${fullName}'s ID Card`}
              fill
              className="object-contain"
            />
          </div>

          <div className="w-full space-y-2 rounded-lg bg-light-300 p-4">
            <div className="flex justify-between">
              <span className="text-sm font-medium text-light-500">Name</span>
              <span className="text-sm font-bold text-dark-400">
                {fullName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium text-light-500">
                University ID
              </span>
              <span className="text-sm font-bold text-dark-400">
                {universityId}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViewUserCard;
