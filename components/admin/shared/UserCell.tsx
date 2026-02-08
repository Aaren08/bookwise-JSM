import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";

const UserCell = ({ fullName, email, image }: UserCellProps) => {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-10">
        <AvatarImage src={image || ""} alt={fullName} />
        <AvatarFallback className="bg-light-100 font-bold text-dark-100">
          {getInitials(fullName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <p className="font-semibold text-dark-400">{fullName}</p>
        <p className="text-xs text-light-500">{email}</p>
      </div>
    </div>
  );
};

export default UserCell;
