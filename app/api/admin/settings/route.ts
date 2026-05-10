import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { requireOwner } from "@/lib/global/auth/require-owner";

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id || session.user.sessionVersion === undefined) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireOwner({
      userId: session.user.id,
      sessionVersion: session.user.sessionVersion,
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      {
        status: 403,
      },
    );
  }
}
