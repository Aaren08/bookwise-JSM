import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  ratelimit,
  authenticatedApiRateLimit,
  anonymousSseConnectRateLimit,
  authenticatedSseConnectRateLimit,
  authEndpointRateLimit,
  receiptMinuteRateLimit,
  receiptDailyRateLimit,
  uploadAvatarRateLimit,
  updateAvatarRateLimit,
} from "@/lib/essentials/rateLimit";

const isTest = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";

const RATE_LIMITERS: Record<string, typeof ratelimit> = {
  "api:anonymous": ratelimit,
  "api:authenticated": authenticatedApiRateLimit,
  "sse:anonymous-connect": anonymousSseConnectRateLimit,
  "sse:authenticated-connect": authenticatedSseConnectRateLimit,
  "auth:token-bucket": authEndpointRateLimit,
  "receipt:minute": receiptMinuteRateLimit,
  "receipt:daily": receiptDailyRateLimit,
  "upload-avatar": uploadAvatarRateLimit,
  "update-avatar": updateAvatarRateLimit,
};

export async function POST(req: Request) {
  if (!isTest) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { limiter: limiterKey, receiptId } = body;

    if (!limiterKey || !RATE_LIMITERS[limiterKey]) {
      return NextResponse.json(
        { error: `Unknown limiter: ${limiterKey}. Available: ${Object.keys(RATE_LIMITERS).join(", ")}` },
        { status: 400 },
      );
    }

    let identifier: string;

    if (receiptId) {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      identifier = `receipt-download:user:${session.user.id}:receipt:${receiptId}`;
    } else if (body.identifier && typeof body.identifier === "string") {
      identifier = body.identifier;
    } else {
      return NextResponse.json({ error: "Missing receiptId or identifier" }, { status: 400 });
    }

    const rateLimiter = RATE_LIMITERS[limiterKey];
    await rateLimiter.resetUsedTokens(identifier);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to reset rate limit:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
