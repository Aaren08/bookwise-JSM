import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { users } from "@/database/schema";
import { eq } from "drizzle-orm";

type AuthSession = {
  user?: {
    id?: string;
    role?: string;
    sessionVersion?: number;
  };
};

export default auth(async (req) => {
  const session = req.auth as AuthSession | undefined;
  const { pathname } = req.nextUrl;

  // Non-admin paths: nothing to do
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // No session → redirect
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  // Role check in JWT (fast path — no DB hit)
  if (session.user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Version check (DB hit — runs only for /admin routes)
  // This is the hard gate: if the token's sessionVersion is stale,
  // the user is out even if the SSE message hasn't arrived yet.
  try {
    const [dbUser] = await db
      .select({
        role: users.role,
        sessionVersion: users.sessionVersion,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (
      !dbUser ||
      dbUser.role !== "ADMIN" ||
      dbUser.sessionVersion !== (session.user.sessionVersion ?? 1)
    ) {
      // Version mismatch or role mismatch — invalidate the session cookie
      const response = NextResponse.redirect(new URL("/sign-in", req.url));
      // Clear the NextAuth cookie so the browser doesn't loop
      response.cookies.delete("authjs.session-token");
      response.cookies.delete("__Secure-authjs.session-token");
      return response;
    }
  } catch (error) {
    console.error("[middleware] Session version check failed:", error);
    // Fail open on DB errors — don't lock everyone out on transient failures
    // Consider fail-closed if your threat model demands it
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
