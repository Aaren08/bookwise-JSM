import { ReactNode } from "react";
import FilterData from "../FilterData";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface TableContainerProps {
  title: string;
  children: ReactNode;
  onSort: (order: "asc" | "desc") => void;
  filterLabel?: string;
  showCreateButton?: boolean;
  createButtonHref?: string;
  createButtonText?: string;
}

const TableContainer = ({
  title,
  children,
  onSort,
  filterLabel,
  showCreateButton = false,
  createButtonHref = "/admin/books/new",
  createButtonText = "Create a New Book",
}: TableContainerProps) => {
  return (
    <section className="w-full rounded-2xl bg-white p-7 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-dark-400">{title}</h2>
        <div className="flex items-center flex-wrap gap-2">
          <FilterData onSort={onSort} label={filterLabel} />
          {showCreateButton && (
            <Button
              asChild
              className="bg-primary-admin hover:bg-primary-admin/90 text-white"
            >
              <Link href={createButtonHref}>
                <Plus className="mr-2 h-4 w-4" />
                {createButtonText}
              </Link>
            </Button>
          )}
        </div>
      </div>
      <div className="mt-7 w-full overflow-x-auto">
        <table className="w-full min-w-max table-auto text-left">
          {children}
        </table>
      </div>
    </section>
  );
};

export default TableContainer;
