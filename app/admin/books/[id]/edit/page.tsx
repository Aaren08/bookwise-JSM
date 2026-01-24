import { Button } from "@/components/ui/button";
import Link from "next/link";
import BookForm from "@/components/admin/forms/BookForm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/database/drizzle";
import { books } from "@/database/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";

const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;

  const validId = z.uuid().safeParse(id);
  if (!validId.success) return notFound();

  const [book] = await db.select().from(books).where(eq(books.id, id)).limit(1);

  return (
    <>
      <Button asChild className="back-btn">
        <Link href="/admin/books">
          <ChevronLeft className="-mr-1 h-4 w-4" />
          Go Back
        </Link>
      </Button>

      <section className="w-full max-w-2xl">
        <BookForm type="update" {...book} />
      </section>
    </>
  );
};

export default Page;
