import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdminDashboardSnapshot } from "@/lib/admin/stats";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getAdminDashboardSnapshot();

  return NextResponse.json(snapshot);
}
