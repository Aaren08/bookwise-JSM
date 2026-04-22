export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  ADMIN_DASHBOARD_SSE_KEEPALIVE_MS,
  ADMIN_DASHBOARD_SSE_RETRY_MS,
} from "@/lib/admin/realtime/dashboardRealtimeEvents";
import { encodeBorrowBookSseEvent } from "@/lib/admin/realtime/borrowBookRealtimeEvents";
import { addAdminDashboardRealtimeListener } from "@/lib/admin/realtime/dashboardRealtimeBroker";
import { ratelimit, safeRateLimit } from "@/lib/essentials/rateLimit";

let activeStreamListeners = 0;
const MAX_STREAM_LISTENERS = 100;

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "127.0.0.1";
  
  // Enforce IP rate limiting to prevent abuse
  const { success } = await safeRateLimit(ratelimit, ip);
  if (!success || activeStreamListeners >= MAX_STREAM_LISTENERS) {
    return new Response("Too Many Requests", { status: 429 });
  }

  // Parse optional bookId to filter incoming pub/sub events
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId");

  activeStreamListeners++;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;

      const enqueue = (payload: string) => {
        if (isClosed) return;
        controller.enqueue(encoder.encode(payload));
      };

      enqueue(`retry: ${ADMIN_DASHBOARD_SSE_RETRY_MS}\n\n`);

      const removeListener = addAdminDashboardRealtimeListener((message) => {
        // Only forward public inventory events — never send admin-only messages
        if (message.type === "BOOK_UPDATED") {
          if (!bookId || message.bookId === bookId) {
            enqueue(encodeBorrowBookSseEvent(message));
          }
        }
      });

      const keepAlive = setInterval(() => {
        enqueue(": keepalive\n\n");
      }, ADMIN_DASHBOARD_SSE_KEEPALIVE_MS);

      const close = () => {
        if (isClosed) return;
        isClosed = true;
        activeStreamListeners--;
        clearInterval(keepAlive);
        request.signal.removeEventListener("abort", close);
        removeListener();
        controller.close();
      };

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      // The abort signal listener handles the decrement via close()
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
