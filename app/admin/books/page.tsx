import BookTable from "@/components/admin/BookTable";
import { getAllBooks } from "@/lib/admin/actions/book";
import NavigatePage from "@/components/NavigatePage";

const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) => {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;

  const booksResult = await getAllBooks({ page });

  const booksData = booksResult.success ? booksResult.data?.books : [];
  const totalPages = booksResult.success
    ? booksResult.data?.totalPages || 0
    : 0;

  return (
    <>
      <BookTable books={booksData} />
      <div className="mt-8 w-full flex justify-end">
        <NavigatePage currentPage={page} totalPages={totalPages} />
      </div>
    </>
  );
};

export default Page;
