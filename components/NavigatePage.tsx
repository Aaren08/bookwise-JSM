import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import {
  buildRouteHref,
  getPaginationNumbers,
  SearchRouteFilter,
} from "@/lib/performance/navigation";
import { PrefetchOnIntentLink } from "@/lib/performance/PrefetchOnIntentLink";

interface NavigatePageProps {
  basePath?: string;
  currentPage: number;
  totalPages: number;
  query?: string;
  filter?: SearchRouteFilter;
}

const NavigatePage = ({
  basePath = "/search",
  currentPage,
  totalPages,
  query = "",
  filter,
}: NavigatePageProps) => {
  const pageNumbers = getPaginationNumbers(currentPage, totalPages);
  const isPreviousDisabled = currentPage === 1;
  const isNextDisabled = currentPage === totalPages;

  return (
    <div id="pagination" className="mt-10 mb-20">
      {/* Previous Button */}
      {isPreviousDisabled ? (
        <Button
          disabled
          aria-disabled="true"
          className="pagination-btn_dark"
          size="icon"
        >
          <ChevronLeft className="size-5" />
        </Button>
      ) : (
        <Button asChild className="pagination-btn_dark" size="icon">
          <PrefetchOnIntentLink
            href={buildRouteHref({
              basePath,
              query,
              filter,
              page: currentPage - 1,
            })}
            scroll={false}
          >
            <ChevronLeft className="size-5" />
          </PrefetchOnIntentLink>
        </Button>
      )}

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
              asChild
              className={
                isActive ? "pagination-btn_light" : "pagination-btn_dark"
              }
              size="icon"
            >
              <PrefetchOnIntentLink
                href={buildRouteHref({
                  basePath,
                  query,
                  filter,
                  page: page as number,
                })}
                scroll={false}
              >
                {page}
              </PrefetchOnIntentLink>
            </Button>
          );
        })}
      </div>

      {/* Next Button */}
      {isNextDisabled ? (
        <Button
          disabled
          aria-disabled="true"
          className="pagination-btn_dark"
          size="icon"
        >
          <ChevronRight className="size-5" />
        </Button>
      ) : (
        <Button asChild className="pagination-btn_dark" size="icon">
          <PrefetchOnIntentLink
            href={buildRouteHref({
              basePath,
              query,
              filter,
              page: currentPage + 1,
            })}
            scroll={false}
          >
            <ChevronRight className="size-5" />
          </PrefetchOnIntentLink>
        </Button>
      )}
    </div>
  );
};

export default NavigatePage;
