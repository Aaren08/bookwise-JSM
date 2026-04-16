import NavigatePage from "@/components/NavigatePage";
import FilterData from "@/components/admin/FilterData";
import UserTable from "@/components/admin/tables/UserTable";
import { UserTableHeader } from "@/components/admin/tables/table-header/UserTableHeader";
import { getApprovedUsers } from "@/lib/admin/actions/user";
import { Suspense } from "react";
import { PartialTableWrapper } from "@/components/admin/PartialTableWrapper";

// Unified data fetching - called ONCE
async function getUsersData(page: number) {
  const result = await getApprovedUsers({ page });
  if (!result.success) {
    throw new Error(result.error || "Failed to fetch users");
  }
  return result.data;
}

// Table body component
async function UsersTableBody({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getUsersData(page);
  return <UserTable users={data?.users || []} />;
}

// Pagination component
async function UsersPagination({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getUsersData(page);
  const totalPages = data?.totalPages || 0;

  return (
    <div className="mt-8 w-full flex justify-end">
      <NavigatePage
        basePath="/admin/users"
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
        columns={["avatar-text", "date", "badge", "badge", "text", "text", "actions"]}
        header={<UserTableHeader />}
        title="All Users"
        filterSlot={<FilterData label="A-Z" />}
      >
        <UsersTableBody searchParams={searchParams} />
      </PartialTableWrapper>

      {/* Pagination with minimal skeleton */}
      <Suspense fallback={<PaginationSkeleton />}>
        <UsersPagination searchParams={searchParams} />
      </Suspense>
    </>
  );
};

export default Page;
