import { auth } from "@/auth";
import BookOverview from "@/components/BookOverview";
import BookVideo from "@/components/BookVideo";
import BookCover from "@/components/BookCover";
import { db } from "@/database/drizzle";
import { books } from "@/database/schema";
import { eq } from "drizzle-orm";
import { getSimilarBooks } from "@/lib/actions/book";
import Link from "next/link";
import { notFound } from "next/navigation";

const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const [session, [bookDetails], similarBooksResult] = await Promise.all([
    auth(),
    db.select().from(books).where(eq(books.id, id)).limit(1),
    getSimilarBooks(id),
  ]);

  if (!bookDetails) return notFound();

  const similarBooks = similarBooksResult.success
    ? similarBooksResult.data
    : [];

  return (
    <>
      <BookOverview {...bookDetails} userId={session?.user?.id as string} />

      <div className="book-details">
        <div className="flex-[1.5]">
          <section className="flex flex-col gap-7">
            <h3>Video</h3>
            <BookVideo videoUrl={bookDetails.videoUrl} />
          </section>

          <section className=" mt-10 flex flex-col gap-7">
            <h3>Summary</h3>
            <div className="space-y-8 mt-4 text-xl text-light-100">
              {bookDetails.summary.split("\n").map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </section>
        </div>

        {/* Similar Books */}
        <section className="flex flex-col gap-7">
          <h3>Similar Books</h3>
          <div className="grid grid-cols-3 max-sm:grid-cols-2 gap-5">
            {similarBooks.map((book: Book) => (
              <Link key={book.id} href={`/books/${book.id}`}>
                <BookCover
                  variant="regular"
                  className="transition-transform hover:scale-105"
                  coverColor={book.coverColor}
                  coverImage={book.coverUrl}
                />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
};

export default Page;
