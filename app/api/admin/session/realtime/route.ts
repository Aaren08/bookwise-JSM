import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import redis from "@/database/redis";
import {
  ROLE_CHANGE_CHANNEL,
  isRoleChangeEvent,
} from "@/lib/admin/realtime/session/roleChangePublisher";

const KEEPALIVE_MS = 25_000;
const MAX_LIFETIME_MS = 5 * 60 * 1000; // 5 min; client reconnects automatically

export const runtime = "nodejs"; // required for long-lived connections
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();

  // Only active admins get a stream. If they've already been demoted,
  // refuse immediately — the client will handle the 403 as a redirect signal.
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = session.user.id;
  const tokenVersion = session.user.sessionVersion ?? 1;

  const encoder = new TextEncoder();
  const sendEvent = (
    controller: ReadableStreamDefaultController,
    data: object,
  ) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Stream already closed; ignore
    }
  };

  let subscription: ReturnType<typeof redis.subscribe> | null = null;
  let keepaliveTimer: NodeJS.Timeout | null = null;
  let lifetimeTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    if (lifetimeTimer) clearTimeout(lifetimeTimer);
    subscription?.unsubscribe().catch(console.error);
  };

  const stream = new ReadableStream({
    async start(controller) {
      // Confirm connection so the client knows it's live
      sendEvent(controller, {
        type: "session:connected",
        timestamp: new Date().toISOString(),
      });

      // Keepalive comments prevent proxy timeouts
      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, KEEPALIVE_MS);

      // Hard max lifetime — forces a clean reconnect cycle
      lifetimeTimer = setTimeout(() => {
        sendEvent(controller, { type: "session:reconnect" });
        controller.close();
        cleanup();
      }, MAX_LIFETIME_MS);

      // Subscribe — Upstash fan-out handles multiple instances
      subscription = redis.subscribe([ROLE_CHANGE_CHANNEL]);

      subscription.on("message", (data) => {
        if (closed) return;
        try {
          const parsed =
            typeof data.message === "string"
              ? JSON.parse(data.message)
              : data.message;

          if (!isRoleChangeEvent(parsed)) return;

          // Only push to the affected user's stream
          if (parsed.userId !== userId) return;

          // sessionVersion in the event is what the DB was bumped TO.
          // If the token version is already behind, invalidate.
          if (parsed.sessionVersion > tokenVersion) {
            sendEvent(controller, {
              type: "session:invalidated",
              newRole: parsed.newRole,
              sessionVersion: parsed.sessionVersion,
            });
            // Close after sending — client will redirect, no need to keep open
            controller.close();
            cleanup();
          }
        } catch (error) {
          console.error("[session-realtime] Message parse error:", error);
        }
      });

      subscription.on("error", (error) => {
        console.error("[session-realtime] Redis subscription error:", error);
        sendEvent(controller, { type: "session:error" });
        controller.close();
        cleanup();
      });

      // Abort signal (client disconnected / tab closed)
      req.signal.addEventListener("abort", () => {
        controller.close();
        cleanup();
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable Nginx response buffering
    },
  });
}
