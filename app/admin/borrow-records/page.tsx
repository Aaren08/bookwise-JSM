import { getAllBorrowRecords } from "@/lib/admin/actions/borrow";
import NavigatePage from "@/components/NavigatePage";
import BorrowTable from "@/components/admin/BorrowTable";

const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) => {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;

  const borrowRecordsResult = await getAllBorrowRecords({ page });

  const borrowRecordsData = borrowRecordsResult.success
    ? borrowRecordsResult.data?.records
    : [];
  const totalPages = borrowRecordsResult.success
    ? borrowRecordsResult.data?.totalPages || 0
    : 0;

  return (
    <>
      <BorrowTable borrowRecords={borrowRecordsData} />
      <div className="mt-8 w-full flex justify-end">
        <NavigatePage currentPage={page} totalPages={totalPages} />
      </div>
    </>
  );
};

export default Page;
