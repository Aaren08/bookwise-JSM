import { ReactNode } from "react";

interface TableRowProps {
  children: ReactNode;
}

const TableRow = ({ children }: TableRowProps) => {
  return <tr className="table-row">{children}</tr>;
};

export default TableRow;
