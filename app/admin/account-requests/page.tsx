import FilterData from "@/components/admin/FilterData";
import AccountTable from "@/components/admin/tables/AccountTable";
import { AccountTableHeader } from "@/components/admin/tables/table-header/AccountTableHeader";
import NavigatePage from "@/components/NavigatePage";
import { getPendingUsers } from "@/lib/admin/actions/user";
import { Suspense } from "react";
import { PartialTableWrapper } from "@/components/admin/PartialTableWrapper";

// Unified data fetching - called ONCE
async function getAccountRequestsData(page: number) {
  const result = await getPendingUsers({ page });
  if (!result.success) {
    throw new Error(result.error || "Failed to fetch account requests");
  }
  return result.data;
}

// Table body component
async function AccountRequestsTableBody({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getAccountRequestsData(page);
  return <AccountTable users={data?.users || []} />;
}

// Pagination component
async function AccountRequestsPagination({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getAccountRequestsData(page);
  const totalPages = data?.totalPages || 0;

  return (
    <div className="mt-8 w-full flex justify-end">
      <NavigatePage
        basePath="/admin/account-requests"
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
        columns={["avatar-text", "date", "text", "button", "actions"]}
        header={<AccountTableHeader />}
        title="Account Registration Requests"
        filterSlot={<FilterData label="Oldest to Recent" />}
      >
        <AccountRequestsTableBody searchParams={searchParams} />
      </PartialTableWrapper>

      {/* Pagination with minimal skeleton */}
      <Suspense fallback={<PaginationSkeleton />}>
        <AccountRequestsPagination searchParams={searchParams} />
      </Suspense>
    </>
  );
};

export default Page;
