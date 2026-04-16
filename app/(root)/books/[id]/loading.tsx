const BookDetailsLoading = () => {
  return (
    <div className="space-y-10 mt-10 animate-pulse">
      <section className="book-overview">
        <div className="flex flex-1 flex-col gap-5">
          <div className="h-14 w-3/4 rounded bg-dark-700" />
          <div className="h-6 w-1/2 rounded bg-dark-700" />
          <div className="h-24 w-full rounded bg-dark-700" />
          <div className="h-12 w-40 rounded bg-primary/30" />
        </div>
        <div className="flex flex-1 justify-center">
          <div className="h-80 w-56 rounded-2xl bg-dark-700" />
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <div className="h-8 w-24 rounded bg-dark-700" />
          <div className="h-64 rounded-2xl bg-dark-700" />
          <div className="h-8 w-28 rounded bg-dark-700" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-5 rounded bg-dark-700" />
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="h-8 w-36 rounded bg-dark-700" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-40 rounded-2xl bg-dark-700" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetailsLoading;
