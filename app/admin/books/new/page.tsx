import { Button } from "@/components/ui/button";
import Link from "next/link";
import BookForm from "@/components/admin/forms/BookForm";
import { ChevronLeft } from "lucide-react";

const Page = () => {
  return (
    <>
      <Button asChild className="back-btn">
        <Link href="/admin/books">
          <ChevronLeft className="-mr-1 h-4 w-4" />
          Go Back
        </Link>
      </Button>

      <section className="w-full max-w-2xl">
        <BookForm type="create" />
      </section>
    </>
  );
};

export default Page;
