import { auth } from "@/auth";
import BookOverview from "@/components/book/BookOverview";
import BookVideo from "@/components/book/BookVideo";
import BookCover from "@/components/book/BookCover";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  getBookByIdCached,
  getBorrowingEligibilityCached,
  getSimilarBooksCached,
} from "@/lib/performance/cache";
import { PrefetchOnIntentLink } from "@/lib/performance/PrefetchOnIntentLink";

const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;

  const validId = z.uuid().safeParse(id);
  if (!validId.success) return notFound();

  const [session, bookDetails] = await Promise.all([auth(), getBookByIdCached(id)]);

  if (!bookDetails) return notFound();

  const [similarBooks, borrowingEligibility] = await Promise.all([
    getSimilarBooksCached(id),
    session?.user?.id
      ? getBorrowingEligibilityCached(session.user.id, id)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <BookOverview
        {...bookDetails}
        userId={session?.user?.id as string}
        borrowingEligibility={borrowingEligibility}
      />

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
        {similarBooks.length > 0 && (
          <section className="flex flex-col gap-7">
            <h3>Similar Books</h3>
            <div className="grid grid-cols-3 max-sm:grid-cols-2 gap-5">
              {similarBooks.map((book: Book) => (
                <PrefetchOnIntentLink key={book.id} href={`/books/${book.id}`}>
                  <BookCover
                    variant="regular"
                    className="transition-transform hover:scale-105"
                    coverColor={book.coverColor}
                    coverImage={book.coverUrl}
                  />
                </PrefetchOnIntentLink>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
};

export default Page;
