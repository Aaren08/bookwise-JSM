import { sampleBooks } from "@/constants";
import BookList from "../components/BookList";
import BookOverview from "../components/BookOverview";

export default function Home() {
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
