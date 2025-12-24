import { Button } from "@/components/ui/button";
import { CirclePlus } from "lucide-react";
import Link from "next/link";

const Page = () => {
  return (
    <section className="w-full rounded-2xl bg-white p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">All Books</h2>
        <Button className="bg-primary-admin" asChild>
          <Link href={"/admin/books/new"} className="text-white">
            <CirclePlus className="mr-2" /> Create a New Book
          </Link>
        </Button>
      </div>
    </section>
  );
};

export default Page;
