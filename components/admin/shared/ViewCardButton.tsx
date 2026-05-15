import Image from "next/image";

interface ViewCardButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

const ViewCardButton = ({ onClick, disabled }: ViewCardButtonProps) => {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`view-card-btn ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      View ID Card
      <Image
        src="/icons/admin/link.svg"
        alt="link"
        width={18}
        height={18}
        style={{ width: "auto", height: "auto" }}
      />
    </button>
  );
};

export default ViewCardButton;
