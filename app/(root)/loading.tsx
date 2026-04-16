const RootLoading = () => {
  return (
    <div className="space-y-10 mt-10 animate-pulse">
      <section className="book-overview">
        <div className="flex flex-1 flex-col gap-5">
          <div className="h-6 w-32 rounded bg-dark-700" />
          <div className="h-14 w-3/4 rounded bg-dark-700" />
          <div className="h-6 w-2/3 rounded bg-dark-700" />
          <div className="h-24 w-full rounded bg-dark-700" />
          <div className="h-12 w-40 rounded bg-primary/30" />
        </div>
        <div className="flex flex-1 justify-center">
          <div className="h-80 w-56 rounded-2xl bg-dark-700" />
        </div>
      </section>

      <section className="space-y-6">
        <div className="h-10 w-40 rounded bg-dark-700" />
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-3">
              <div className="h-52 rounded-2xl bg-dark-700" />
              <div className="h-5 rounded bg-dark-700" />
              <div className="h-4 w-3/4 rounded bg-dark-700" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default RootLoading;
