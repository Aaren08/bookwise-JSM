import BookOverview from "@/components/admin/BookOverview";
import BookVideo from "@/components/BookVideo";
import { db } from "@/database/drizzle";
import { books } from "@/database/schema";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";

const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;

  //Fetch data based on id
  const [bookDetails] = await db
    .select()
    .from(books)
    .where(eq(books.id, id))
    .limit(1);

  if (!bookDetails) return notFound();

  return (
    <>
      <Button asChild className="back-btn">
        <Link href="/admin/books">
          <ChevronLeft className="-mr-1 h-4 w-4" />
          Go Back
        </Link>
      </Button>
      <BookOverview {...bookDetails} />

      <div className="book-details">
        <div className="flex-[1.5]">
          <section className="flex flex-col gap-7">
            <h3 className="!text-amber-500 font-semibold">Video</h3>
            <BookVideo videoUrl={bookDetails.videoUrl} />
          </section>

          <section className=" mt-10 flex flex-col gap-7">
            <h3 className="!text-amber-500 font-semibold">Summary</h3>
            <div className="space-y-8 mt-4 text-xl text-black">
              {bookDetails.summary.split("\n").map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

export default Page;
