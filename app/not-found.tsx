export default function NotFound() {
  return (
    <main className="root-container flex min-h-screen flex-col items-center justify-center">
      {/* eslint-disable @next/next/no-img-element */}
      <img
        src="/icons/404.svg"
        alt="404 illustration"
        width={500}
        height={500}
        loading="lazy"
      />

      <h1
        className="text-5xl font-bold text-light-100"
        style={{ fontFamily: "var(--bebas-neue)" }}
      >
        Page not found
      </h1>

      <p className="text-light-100 text-xl">
        Sorry, the page you are looking for does not exist.
      </p>
    </main>
  );
}
