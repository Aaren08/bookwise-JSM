import BookCard from "./BookCard";

interface Props {
  title: string;
  books: Book[];
  containerClassName?: string;
}

const BookList = ({ title, books, containerClassName }: Props) => {
  if (books.length < 2) return null;
  return (
    <section className={containerClassName}>
      <h2
        className="text-4xl text-light-100"
        style={{ fontFamily: "var(--bebas-neue)" }}
      >
        {title}
      </h2>

      <ul className="book-list">
        {books.map((book) => (
          <BookCard key={book.id} {...book} />
        ))}
      </ul>
    </section>
  );
};

export default BookList;
