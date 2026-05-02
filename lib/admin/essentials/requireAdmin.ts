import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const requireAdmin = async () => {
  const session = await auth();

  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.role !== "ADMIN") redirect("/");

  return session;
};
