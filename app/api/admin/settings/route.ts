import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  requireAdmin,
  StaleSessionError,
  UnauthorizedError,
} from "@/lib/global/auth/require-admin";
import { PrivilegeEscalationError } from "@/lib/global/ownership-guards";

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id || session.user.sessionVersion === undefined) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireAdmin({
      userId: session.user.id,
      sessionVersion: session.user.sessionVersion,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);

    const isAuthError =
      error instanceof StaleSessionError ||
      error instanceof UnauthorizedError ||
      error instanceof PrivilegeEscalationError;

    return NextResponse.json(
      {
        error: isAuthError ? (error as Error).message : "Internal Server Error",
      },
      { status: isAuthError ? 403 : 500 },
    );
  }
}
