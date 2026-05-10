import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  requireOwner,
  StaleSessionError,
} from "@/lib/global/auth/require-owner";
import {
  PrivilegeEscalationError,
  OwnershipTransferError,
} from "@/lib/global/ownership-guards";

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

    const isAuthError =
      error instanceof StaleSessionError ||
      error instanceof PrivilegeEscalationError ||
      error instanceof OwnershipTransferError;

    return NextResponse.json(
      {
        error: isAuthError ? (error as Error).message : "Internal Server Error",
      },
      { status: isAuthError ? 403 : 500 },
    );
  }
}
