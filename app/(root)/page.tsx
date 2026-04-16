import BookList from "../../components/book/BookList";
import BookOverview from "../../components/book/BookOverview";
import { auth } from "@/auth";
import {
  getBorrowingEligibilityCached,
  getLatestBooksCached,
} from "@/lib/performance/cache";

export default async function Home() {
  const [session, latestBooks] = await Promise.all([
    auth(),
    getLatestBooksCached(10),
  ]);
  const featuredBook = latestBooks[0];
  const borrowingEligibility = session?.user?.id
    ? await getBorrowingEligibilityCached(session.user.id, featuredBook.id)
    : null;

  return (
    <>
      <BookOverview
        {...featuredBook}
        userId={session?.user?.id as string}
        borrowingEligibility={borrowingEligibility}
      />
      <BookList
        title="Popular Books"
        books={latestBooks.slice(1)}
        containerClassName="mt-28"
      />
    </>
  );
}
