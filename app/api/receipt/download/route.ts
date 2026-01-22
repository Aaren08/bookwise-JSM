import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { receiptMinuteRateLimit, receiptDailyRateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { receiptId } = await req.json();

  if (!receiptId) {
    return NextResponse.json({ error: "Missing receiptId" }, { status: 400 });
  }

  const key = `receipt-download:user:${String(session.user.id)}:receipt:${String(receiptId)}`;

  // Minute limit first
  const minuteLimit = await receiptMinuteRateLimit.limit(key);
  if (!minuteLimit.success) {
    return NextResponse.json(
      {
        error: "You are downloading this receipt too frequently.",
        reset: minuteLimit.reset,
      },
      { status: 429 },
    );
  }

  // Daily limit second
  const dailyLimit = await receiptDailyRateLimit.limit(key);
  if (!dailyLimit.success) {
    return NextResponse.json(
      {
        error: "You have reached the daily download limit for this receipt.",
        reset: dailyLimit.reset,
      },
      { status: 429 },
    );
  }

  return NextResponse.json({ allowed: true });
}
