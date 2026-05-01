import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TableRowProps {
  children: ReactNode;
  className?: string;
}

const TableRow = ({ children, className }: TableRowProps) => {
  return <tr className={cn("table-row relative", className)}>{children}</tr>;
};

export default TableRow;
