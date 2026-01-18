"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

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
  const [isImageLoading, setIsImageLoading] = useState(isOpen);

  useEffect(() => {
    setIsImageLoading(isOpen);
  }, [isOpen]);

  const handleImageLoad = () => {
    setIsImageLoading(false);
  };

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="modal-close-btn">
          <X size={20} />
        </button>

        <div className="modal-content">
          <h2 className="modal-title">University ID Card</h2>

          <div className="card-image-wrapper">
            {isImageLoading && (
              <div className="card-image-loader">
                <div className="loader"></div>
              </div>
            )}
            <Image
              src={universityCard}
              alt={`${fullName}'s ID Card`}
              fill
              className="object-contain"
              onLoad={handleImageLoad}
            />
          </div>

          <div className="card-info-section">
            <div className="card-info-row">
              <span className="card-info-label">Name</span>
              <span className="card-info-value">{fullName}</span>
            </div>
            <div className="card-info-row">
              <span className="card-info-label">University ID</span>
              <span className="card-info-value">{universityId}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViewUserCard;
