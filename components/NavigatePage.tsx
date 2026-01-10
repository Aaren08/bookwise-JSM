"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "./ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface NavigatePageProps {
  currentPage: number;
  totalPages: number;
}

const NavigatePage = ({ currentPage, totalPages }: NavigatePageProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", page.toString());
    router.push(`${pathname}?${params.toString()}`);
    router.refresh();

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      // Show all pages if total is less than max visible
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push("...");
      }

      // Show pages around current page
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push("...");
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div id="pagination" className="mt-10 mb-20">
      {/* Previous Button */}
      <Button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="pagination-btn_dark"
        size="icon"
      >
        <ChevronLeft className="size-5" />
      </Button>

      {/* Page Numbers */}
      <div className="flex gap-2">
        {pageNumbers.map((page, index) => {
          if (page === "...") {
            return (
              <p
                key={`ellipsis-${index}`}
                className="pagination-btn_dark inline-flex items-center justify-center"
              >
                ...
              </p>
            );
          }

          const isActive = page === currentPage;
          return (
            <Button
              key={page}
              onClick={() => handlePageChange(page as number)}
              className={
                isActive ? "pagination-btn_light" : "pagination-btn_dark"
              }
              size="icon"
            >
              {page}
            </Button>
          );
        })}
      </div>

      {/* Next Button */}
      <Button
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="pagination-btn_dark"
        size="icon"
      >
        <ChevronRight className="size-5" />
      </Button>
    </div>
  );
};

export default NavigatePage;
