export default function notFound() {
  return (
    <main className="admin-container flex min-h-[80vh] flex-col items-center justify-center">
      {/* eslint-disable @next/next/no-img-element */}
      <img
        src="/icons/admin/404.svg"
        alt="404 illustration"
        width={500}
        height={500}
        loading="lazy"
      />

      <h1
        className="text-5xl font-bold "
        style={{ fontFamily: "var(--bebas-neue)" }}
      >
        Page not found
      </h1>

      <p className="text-xl">
        Sorry, the page you are looking for does not exist.
      </p>
    </main>
  );
}
