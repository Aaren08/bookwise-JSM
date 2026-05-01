import { Button } from "@/components/ui/button";
import Link from "next/link";
import BookForm from "@/components/admin/forms/BookForm";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { notFound } from "next/navigation";

const Page = async () => {
  const session = await auth();
  if (!session || session.user?.role !== "ADMIN") return notFound();

  return (
    <>
      <Button asChild className="back-btn">
        <Link href="/admin/books">
          <ChevronLeft className="-mr-1 h-4 w-4" />
          Go Back
        </Link>
      </Button>

      <section className="w-full max-w-2xl">
        <BookForm
          type="create"
          currentAdmin={{
            id: session.user.id as string,
            name: session.user.name as string,
          }}
        />
      </section>
    </>
  );
};

export default Page;
