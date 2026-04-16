export type SearchRouteFilter =
  | "author"
  | "genre"
  | "rating"
  | "availability";

type RouteParams = {
  basePath?: string;
  filter?: string;
  page?: number;
  query?: string;
};

export const buildRouteHref = ({
  basePath = "/search",
  query,
  filter,
  page,
}: RouteParams) => {
  const params = new URLSearchParams();

  if (query?.trim()) {
    params.set("query", query.trim());
  }

  if (filter) {
    params.set("filter", filter);
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const search = params.toString();

  return search ? `${basePath}?${search}` : basePath;
};

export const buildSearchHref = (params: Omit<RouteParams, "basePath">) =>
  buildRouteHref({ ...params, basePath: "/search" });

export const getPaginationNumbers = (
  currentPage: number,
  totalPages: number,
) => {
  const pages: Array<number | string> = [];
  const maxVisible = 5;

  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i += 1) {
      pages.push(i);
    }

    return pages;
  }

  pages.push(1);

  if (currentPage > 3) {
    pages.push("...");
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let i = start; i <= end; i += 1) {
    pages.push(i);
  }

  if (currentPage < totalPages - 2) {
    pages.push("...");
  }

  pages.push(totalPages);

  return pages;
};
