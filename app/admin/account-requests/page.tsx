import AccountTable from "@/components/admin/AccountTable";
import NavigatePage from "@/components/NavigatePage";
import { getPendingUsers } from "@/lib/admin/actions/user";

const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) => {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;

  const result = await getPendingUsers({ page });
  const pendingUsers = result.success ? result.data?.users : [];
  const totalPages = (result.success && result.data?.totalPages) || 0;

  return (
    <>
      <AccountTable users={pendingUsers} />
      <div className="mt-8 w-full flex justify-end">
        <NavigatePage currentPage={page} totalPages={totalPages} />
      </div>
    </>
  );
};

export default Page;
