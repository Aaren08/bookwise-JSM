import { getAllBorrowRecords } from "@/lib/admin/actions/borrow";
import NavigatePage from "@/components/NavigatePage";
import BorrowTable from "@/components/admin/tables/BorrowTable";
import { BorrowTableHeader } from "@/components/admin/tables/table-header/BorrowTableHeader";
import ClearRecordMenu from "@/components/admin/shared/ClearRecordMenu";
import { Suspense } from "react";
import FilterData from "@/components/admin/FilterData";
import { PartialTableWrapper } from "@/components/admin/PartialTableWrapper";
import { auth } from "@/auth";

// Unified data fetching - called ONCE
async function getBorrowRecordsData(page: number) {
  const result = await getAllBorrowRecords({ page });
  if (!result.success) {
    throw new Error(result.message || "Failed to fetch borrow records");
  }
  return result.data;
}

// Table body component
async function BorrowRecordsTableBody({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getBorrowRecordsData(page);
  const session = await auth();

  return (
    <BorrowTable
      borrowRecords={data?.records || []}
      currentAdmin={{
        id: session?.user?.id || "",
        name: session?.user?.name || "Admin",
      }}
    />
  );
}

// Pagination component
async function BorrowRecordsPagination({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getBorrowRecordsData(page);
  const totalPages = data?.totalPages || 0;

  return (
    <div className="mt-8 w-full flex justify-end">
      <NavigatePage
        basePath="/admin/borrow-records"
        currentPage={page}
        totalPages={totalPages}
      />
    </div>
  );
}

// Minimal pagination skeleton
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
        columns={["image-text", "avatar-text", "badge", "date", "date", "date", "text"]}
        header={<BorrowTableHeader />}
        title="Borrow Book Requests"
        filterSlot={
          <>
            <ClearRecordMenu />
            <FilterData label="Oldest to Recent" />
          </>
        }
      >
        <BorrowRecordsTableBody searchParams={searchParams} />
      </PartialTableWrapper>

      {/* Pagination with minimal skeleton */}
      <Suspense fallback={<PaginationSkeleton />}>
        <BorrowRecordsPagination searchParams={searchParams} />
      </Suspense>
    </>
  );
};

export default Page;
