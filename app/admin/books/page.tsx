import BookTable from "@/components/admin/tables/BookTable";
import { BookTableHeader } from "@/components/admin/tables/table-header/BookTableHeader";
import { getAllBooks } from "@/lib/admin/actions/book";
import NavigatePage from "@/components/NavigatePage";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import FilterData from "@/components/admin/FilterData";
import { PartialTableWrapper } from "@/components/admin/PartialTableWrapper";

// Unified data fetching - called ONCE and result is split
async function getBooksData(page: number) {
  const result = await getAllBooks({ page });
  if (!result.success) {
    throw new Error(result.message || "Failed to fetch books");
  }
  return result.data;
}

// Table body component - uses Suspense for partial loading
async function BooksTableBody({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getBooksData(page);
  return <BookTable books={data?.books || []} />;
}

// Pagination component - uses same data
async function BooksPagination({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getBooksData(page);
  const totalPages = data?.totalPages || 0;

  return (
    <div className="mt-8 w-full flex justify-end">
      <NavigatePage
        basePath="/admin/books"
        currentPage={page}
        totalPages={totalPages}
      />
    </div>
  );
}

// Minimal pagination skeleton - just a placeholder box
const PaginationSkeleton = () => (
  <div className="mt-8 w-full flex justify-end">
    <div className="h-10 w-40 rounded bg-skeleton" />
  </div>
);

const Page = ({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) => {

  return (
    <>
      <PartialTableWrapper
        columns={["image-text", "text", "badge", "date", "actions"]}
        header={<BookTableHeader />}
        title="All Books"
        filterSlot={
          <>
            <FilterData label="A-Z" />
            <Button
              asChild
              className="bg-primary-admin hover:bg-primary-admin/90 text-white"
            >
              <Link href="/admin/books/new">
                <Plus className="mr-2 h-4 w-4" />
                Create a New Book
              </Link>
            </Button>
          </>
        }
      >
        <BooksTableBody searchParams={searchParams} />
      </PartialTableWrapper>

      {/* Pagination with minimal skeleton */}
      <Suspense fallback={<PaginationSkeleton />}>
        <BooksPagination searchParams={searchParams} />
      </Suspense>
    </>
  );
};

export default Page;
