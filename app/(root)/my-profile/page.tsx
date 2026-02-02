import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Image from "next/image";
import UserProfile from "@/components/UserProfile";
import BookList from "@/components/BookList";
import NavigatePage from "@/components/NavigatePage";
import { getUserProfile, getUserBorrowedBooks } from "@/lib/actions/user";

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

const Page = async ({ searchParams }: PageProps) => {
  const session = await auth();
  const params = await searchParams;

  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const currentPage = Number(params.page) || 1;

  // Fetch user profile and borrowed books
  const [profileResult, booksResult] = await Promise.all([
    getUserProfile(session.user.id),
    getUserBorrowedBooks(session.user.id, currentPage, 6),
  ]);

  if (!profileResult.success || !booksResult.success || !booksResult.data) {
    return (
      <main className="flex min-h-[75vh] flex-col items-center justify-center">
        {/* eslint-disable @next/next/no-img-element */}
        <img
          src="/icons/404.svg"
          alt="404 illustration"
          width={500}
          height={500}
          loading="lazy"
        />

        <h1
          className="text-5xl text-light-100 font-bold "
          style={{ fontFamily: "var(--bebas-neue)" }}
        >
          Page not found
        </h1>
      </main>
    );
  }

  const user = profileResult.data;
  const { books, pagination } = booksResult.data;
  const showPagination = pagination.totalBooks > 4;

  // Transform books to include loan information
  const borrowedBooks: Book[] = books.map((book: Book) => ({
    ...book,
    isLoanedBook: true,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-12 mt-10 mb-20">
      {/* Left Side - User Profile */}
      <div className="w-full">
        <UserProfile
          id={user.id}
          fullName={user.fullName}
          email={user.email}
          universityId={user.universityId}
          universityCard={user.universityCard}
          userAvatar={user.userAvatar}
          status={user.status}
        />
      </div>

      {/* Right Side - Borrowed Books */}
      <div className="w-full">
        {borrowedBooks.length > 0 ? (
          <>
            <BookList title="Borrowed books" books={borrowedBooks} />

            {/* Pagination - Only show if more than 6 books */}
            {showPagination && (
              <NavigatePage
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 mt-10">
            <Image
              src="/images/no-books.png"
              alt="No books borrowed"
              width={180}
              height={180}
              className="object-contain"
            />
            <p className="text-light-100 text-xl font-semibold text-center">
              No books are borrowed yet. Borrow <br /> some books to display
              them here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Page;
