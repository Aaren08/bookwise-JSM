import Image from "next/image";

interface ViewCardButtonProps {
  onClick: () => void;
}

const ViewCardButton = ({ onClick }: ViewCardButtonProps) => {
  return (
    <button onClick={onClick} className="view-card-btn">
      View ID Card
      <Image src="/icons/admin/link.svg" alt="link" width={18} height={18} />
    </button>
  );
};

export default ViewCardButton;
