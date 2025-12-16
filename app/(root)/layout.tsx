import { ReactNode } from "react";
import Header from "../../components/Header";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/database/drizzle";
import { users } from "@/database/schema";
import { eq } from "drizzle-orm";

const layout = async ({ children }: { children: ReactNode }) => {
  const session = await auth();

  if (!session) {
    return redirect("/sign-in");
  }

  // Update user last activity date
  after(async () => {
    if (!session?.user?.id) return;

    // check user last activity date once per day
    const result = await db
      .select({ lastActivityDate: users.lastActivityDate })
      .from(users)
      .where(eq(users.id, session?.user?.id))
      .limit(1);

    const dbLastActivityDate = result[0]?.lastActivityDate;
    const today = new Date().toISOString().slice(0, 10);

    if (
      dbLastActivityDate &&
      new Date(dbLastActivityDate).toISOString().slice(0, 10) === today
    ) {
      return;
    }

    await db
      .update(users)
      .set({
        lastActivityDate: new Date().toISOString().slice(0, 10),
      })
      .where(eq(users.id, session?.user?.id));
  });

  return (
    <main className="root-container">
      <div className="mx-auto max-w-7xl">
        <Header session={session} />
        <div className="mt-20 pb-20">{children}</div>
      </div>
    </main>
  );
};

export default layout;
