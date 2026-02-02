import Image from "next/image";
import BookCover from "../book/BookCover";

const BookOverview = async ({
  title,
  author,
  genre,
  rating,
  totalCopies,
  availableCopies,
  description,
  coverColor,
  coverUrl,
}: Book) => {
  return (
    <section className="book-overview">
      <div className="flex flex-1 flex-col gap-5">
        <h1 className="font-semibold text-black">{title}</h1>

        <div className="book-info">
          <p className="text-blue-600 font-semibold">
            By: <span className="font-semibold text-amber-500">{author}</span>
          </p>

          <p className="text-blue-600 font-semibold">
            Category:{" "}
            <span className="font-semibold text-amber-500">{genre}</span>
          </p>

          <div className="flex flex-row gap-1">
            <Image src="/icons/star.svg" alt="star" width={22} height={22} />
            <p className="font-semibold text-amber-500">{rating}/5</p>
          </div>
        </div>

        <div className="book-copies">
          <p className="text-blue-600 font-semibold">
            Total Books:
            <span className="font-semibold text-amber-500">{totalCopies}</span>
          </p>

          <p className="text-blue-600 font-semibold">
            Available Books:
            <span className="font-semibold text-amber-500">
              {availableCopies}
            </span>
          </p>
        </div>

        <p className="book-description text-black font-semibold">
          {description}
        </p>
      </div>

      <div className="relative flex flex-1 justify-center">
        <div className="relative">
          <BookCover
            variant="wide"
            className="z-10"
            coverColor={coverColor}
            coverImage={coverUrl}
          />

          <div className="absolute left-16 top-10 rotate-12 opacity-40 max-sm:hidden">
            <BookCover
              variant="wide"
              coverColor={coverColor}
              coverImage={coverUrl}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default BookOverview;
