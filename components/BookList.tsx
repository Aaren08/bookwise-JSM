import BookCard from "./BookCard";
import BorrowedBookCard from "./BorrowedBookCard";

interface Props {
  title: string;
  books: Book[];
  containerClassName?: string;
}

const BookList = ({ title, books, containerClassName }: Props) => {
  return (
    <section className={containerClassName}>
      <h2
        className="text-4xl text-light-100"
        style={{ fontFamily: "var(--bebas-neue)" }}
      >
        {title}
      </h2>

      <ul className="book-list">
        {books.map((book) => {
          if (book.isLoanedBook && book.borrowDate && book.dueDate) {
            return (
              <BorrowedBookCard
                key={book.id}
                {...book}
                borrowDate={book.borrowDate}
                dueDate={book.dueDate}
                borrowRecordId={book.borrowRecordId}
                borrowStatus={book.borrowStatus}
                returnDate={book.returnDate}
              />
            );
          }

          return <BookCard key={book.id} {...book} />;
        })}
      </ul>
    </section>
  );
};

export default BookList;
