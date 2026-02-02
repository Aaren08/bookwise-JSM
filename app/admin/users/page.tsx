import NavigatePage from "@/components/NavigatePage";
import UserTable from "@/components/admin/tables/UserTable";
import { getAllUsers } from "@/lib/admin/actions/user";

const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) => {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;
  const users = await getAllUsers({ page });

  const usersData = users.success ? users.data?.users : [];
  const totalPages = users.success ? users.data?.totalPages || 0 : 0;

  return (
    <>
      <UserTable users={usersData} />
      <div className="mt-8 w-full flex justify-end">
        <NavigatePage currentPage={page} totalPages={totalPages} />
      </div>
    </>
  );
};

export default Page;
