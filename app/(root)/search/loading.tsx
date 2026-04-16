const SearchLoading = () => {
  return (
    <div className="mx-auto mt-16 w-full max-w-7xl animate-pulse space-y-10">
      <section className="library space-y-5">
        <div className="h-5 w-40 rounded bg-dark-700" />
        <div className="h-20 w-2/3 rounded bg-dark-700" />
        <div className="h-14 w-full rounded-full bg-dark-700" />
      </section>

      <section className="space-y-6">
        <div className="h-10 w-40 rounded bg-dark-700" />
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
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

export default SearchLoading;
