import { auth } from "@/auth";
import { AUTH_ILLUSTRATION_SIZES } from "@/lib/performance/lcp";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

const Layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();

  if (session) {
    return redirect("/");
  }

  return (
    <main className="auth-container">
      <section className="auth-form">
        <div className="auth-box">
          <div className="flex flex-row gap-3">
            <Image
              src="/icons/logo.svg"
              alt="Logo"
              width={37}
              height={37}
              style={{ width: "auto", height: "auto" }}
            />
            <h1 className="text-2xl font-semibold">BookWise</h1>
          </div>

          <div>{children}</div>
        </div>
      </section>

      <section className="auth-illustration hidden sm:block">
        <Image
          src="/images/auth-illustration.png"
          alt="Auth Illustration"
          width={1000}
          height={1000}
          sizes={AUTH_ILLUSTRATION_SIZES}
          quality={70}
          className="size-full object-cover"
        />
      </section>
    </main>
  );
};

export default Layout;
