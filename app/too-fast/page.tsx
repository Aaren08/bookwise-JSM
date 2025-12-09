const Page = () => {
  return (
    <main className="root-container flex min-h-screen flex-col items-center justify-center">
      <h1
        className="text-5xl font-bold text-light-100"
        style={{ fontFamily: "var(--bebas-neue)" }}
      >
        You are too fast!
      </h1>
      <p className="mt-2 text-xl text-light-100">
        You have made too many requests. Please try again later.
      </p>
    </main>
  );
};

export default Page;
