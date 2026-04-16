import NavigatePage from "@/components/NavigatePage";
import FilterData from "@/components/admin/FilterData";
import UserTable from "@/components/admin/tables/UserTable";
import { UserTableHeader } from "@/components/admin/tables/table-header/UserTableHeader";
import { getApprovedUsers } from "@/lib/admin/actions/user";
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
function UsersTableBody({ users }: { users: User[] }) {
  return <UserTable users={users} />;
}

// Pagination component
function UsersPagination({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  return (
    <div className="mt-8 w-full flex justify-end">
      <NavigatePage
        basePath="/admin/users"
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </div>
  );
}

const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) => {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const data = await getUsersData(page);

  return (
    <>
      <PartialTableWrapper
        columns={[
          "avatar-text",
          "date",
          "badge",
          "badge",
          "text",
          "text",
          "actions",
        ]}
        header={<UserTableHeader />}
        title="All Users"
        filterSlot={<FilterData label="A-Z" />}
      >
        <UsersTableBody users={data?.users || []} />
      </PartialTableWrapper>

      <UsersPagination currentPage={page} totalPages={data?.totalPages || 0} />
    </>
  );
};

export default Page;
