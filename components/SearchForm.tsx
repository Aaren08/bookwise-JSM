import Image from "next/image";
import { Input } from "./ui/input";
import { SearchRouteFilter } from "@/lib/performance/navigation";

interface SearchFormProps {
  initialQuery?: string;
  currentFilter?: SearchRouteFilter;
}

const SearchForm = ({
  initialQuery = "",
  currentFilter = "author",
}: SearchFormProps) => {
  return (
    <form action="/search" method="get" className="search">
      <Image
        src="/icons/search-fill.svg"
        alt="search"
        width={24}
        height={24}
        className="ml-2"
      />
      <input type="hidden" name="filter" value={currentFilter} />
      <Input
        name="query"
        type="text"
        placeholder="Search for books, authors, genres..."
        defaultValue={initialQuery}
        className="search-input"
        aria-label="Search books, authors, genres"
      />
    </form>
  );
};

export default SearchForm;
