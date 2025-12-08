import { sampleBooks } from "@/constants";
import BookList from "../../components/BookList";
import BookOverview from "../../components/BookOverview";
import { db } from "@/database/drizzle";
import { users } from "@/database/schema";

export default async function Home() {
  const result = await db.select().from(users);
  console.log(JSON.stringify(result, null, 2));
  return (
    <>
      <BookOverview {...sampleBooks[0]} />
      <BookList
        title="Popular Books"
        books={sampleBooks}
        containerClassName="mt-28"
      />
    </>
  );
}
