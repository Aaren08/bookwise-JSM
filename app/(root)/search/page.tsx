import { Suspense } from "react";
import Image from "next/image";
import SearchForm from "@/components/SearchForm";
import SearchFilter from "@/components/SearchFilter";
import BookList from "@/components/BookList";
import NavigatePage from "@/components/NavigatePage";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { searchBooks } from "@/lib/searchQuery";

interface SearchPageProps {
  searchParams: Promise<{
    query?: string;
    filter?: string;
    page?: string;
  }>;
}

const BOOKS_PER_PAGE = 12;

async function BookResults({
  query,
  filter,
  currentPage,
}: {
  query: string;
  filter: "author" | "genre" | "rating" | "availability";
  currentPage: number;
}) {
  const { books: bookResults, totalPages } = await searchBooks({
    query,
    filter,
    page: currentPage,
    limit: BOOKS_PER_PAGE,
  });

  const hasResults = bookResults.length > 0;

  return (
    <>
      {query && (
        <div className="mt-16">
          {hasResults ? (
            <>
              {/* Results Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
                <div>
                  <h2
                    className="text-4xl text-light-100"
                    style={{ fontFamily: "var(--bebas-neue)" }}
                  >
                    Search Results
                  </h2>
                  <p className="text-light-100 mt-2">
                    Search results for{" "}
                    <span className="font-semibold text-primary">{query}</span>
                  </p>
                </div>
                <SearchFilter currentFilter={filter} />
              </div>

              {/* Book List */}
              <BookList title="" books={bookResults} />

              {/* Pagination */}
              {totalPages > 1 && (
                <NavigatePage
                  currentPage={currentPage}
                  totalPages={totalPages}
                />
              )}
            </>
          ) : (
            /* No Results */
            <div id="not-found">
              <Image
                src="/images/no-books.png"
                alt="No books found"
                width={200}
                height={200}
                className="object-contain"
              />
              <h4>No Results Found</h4>
              <p>
                We couldn&apos;t find any books matching your search.
                <br />
                Try using different keywords or check for typos.
              </p>
              <Link href="/search">
                <Button className="not-found-btn cursor-pointer">
                  Clear Search
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Show all books if no query */}
      {!query && hasResults && (
        <div className="mt-16">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
            <h2
              className="text-4xl text-light-100"
              style={{ fontFamily: "var(--bebas-neue)" }}
            >
              All Books
            </h2>
          </div>

          <BookList title="" books={bookResults} />

          {totalPages > 1 && (
            <NavigatePage currentPage={currentPage} totalPages={totalPages} />
          )}
        </div>
      )}
    </>
  );
}

async function SearchContent({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = params.query || "";
  const filter = (params.filter || "author") as
    | "author"
    | "genre"
    | "rating"
    | "availability";
  const currentPage = parseInt(params.page || "1", 10);

  return (
    <div className="mx-auto w-full max-w-7xl">
      {/* Hero Section */}
      <section className="library mt-16">
        <p className="library-subtitle">Discover Your Next Great Read:</p>
        <h1 className="library-title">
          Explore and Search for
          <br />
          Any Book In Our Library
        </h1>

        <SearchForm initialQuery={query} />
      </section>

      {/* Search Results Section with Suspense for BookResults */}
      <Suspense
        fallback={
          <div className="mt-16">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
              <div>
                <h2
                  className="text-4xl text-light-100"
                  style={{ fontFamily: "var(--bebas-neue)" }}
                >
                  Loading Results...
                </h2>
              </div>
            </div>
            <div className="book-list">
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse bg-dark-300 rounded-lg h-[300px]"
                />
              ))}
            </div>
          </div>
        }
      >
        <BookResults query={query} filter={filter} currentPage={currentPage} />
      </Suspense>
    </div>
  );
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  return <SearchContent searchParams={searchParams} />;
}
