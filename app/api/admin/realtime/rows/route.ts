import redis from "@/database/redis";
import {
  ADMIN_ROW_LOCKS_CHANNEL,
  ADMIN_ROW_REALTIME_CHANNELS,
  ADMIN_ROW_REALTIME_HEARTBEAT_MS,
  ADMIN_ROW_REALTIME_RETRY_MS,
  encodeAdminRealtimeEvent,
  encodeHeartbeatEvent,
  isAdminRealtimeEvent,
} from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";
import { requireAdminActor } from "@/lib/admin/realtime/concurrency/rowConcurrency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = [...ADMIN_ROW_REALTIME_CHANNELS, ADMIN_ROW_LOCKS_CHANNEL];
const isDevelopment = process.env.NODE_ENV === "development";

const devLog = (message?: unknown, ...optionalParams: unknown[]) => {
  if (!isDevelopment) return;
  console.error(message, ...optionalParams);
};

export async function GET(request: Request) {
  try {
    await requireAdminActor();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;
      const subscription = redis.subscribe(CHANNELS);

      const enqueue = (payload: string) => {
        if (isClosed) return;
        controller.enqueue(encoder.encode(payload));
      };

      // Tell the client the reconnect delay
      enqueue(`retry: ${ADMIN_ROW_REALTIME_RETRY_MS}\n\n`);

      // Send an immediate heartbeat so the client knows the connection is live
      enqueue(encodeHeartbeatEvent());

      subscription.on("message", (payload) => {
        try {
          const parsed =
            typeof payload.message === "string"
              ? (JSON.parse(payload.message) as unknown)
              : payload.message;

          if (!isAdminRealtimeEvent(parsed)) {
            return;
          }

          enqueue(encodeAdminRealtimeEvent(parsed));
        } catch (error) {
          devLog("Failed to parse admin realtime payload:", error);
        }
      });

      subscription.on("error", (error) => {
        devLog("Admin realtime Redis subscription error:", error);
      });

      // Real named heartbeat event every ADMIN_ROW_REALTIME_HEARTBEAT_MS.
      // Unlike SSE comments, a named event resets proxy body-read timeouts
      // and lets the client detect liveness.
      const heartbeat = setInterval(() => {
        enqueue(encodeHeartbeatEvent());
      }, ADMIN_ROW_REALTIME_HEARTBEAT_MS);

      const close = () => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        void subscription.unsubscribe().catch((error) => {
          devLog("Failed to unsubscribe admin realtime stream:", error);
        });
        controller.close();
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      // Prevent Nginx / Vercel edge from buffering the stream
      "X-Accel-Buffering": "no",
    },
  });
}
