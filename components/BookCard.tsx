import Link from "next/link";
import BookCover from "./BookCover";
import { cn } from "@/lib/utils";

interface BookCardProps extends Book {
  className?: string;
  children?: React.ReactNode;
}

const BookCard = ({
  id,
  title,
  genre,
  coverColor,
  coverUrl,
  className,
  children,
}: BookCardProps) => (
  <li className={cn(className)}>
    <Link
      href={`/books/${id}`}
      className={cn("w-full flex flex-col items-center")}
    >
      <BookCover coverColor={coverColor} coverImage={coverUrl} />

      <div
        className={cn(
          "mt-4 justify-start w-full",
          !children && "xs:max-w-40 max-w-28"
        )}
      >
        <p className="book-title">{title}</p>
        <p className="book-genre">{genre}</p>
      </div>

      {children}
    </Link>
  </li>
);

export default BookCard;
