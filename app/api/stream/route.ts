export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  ADMIN_DASHBOARD_SSE_KEEPALIVE_MS,
  ADMIN_DASHBOARD_SSE_RETRY_MS,
} from "@/lib/admin/realtime/dashboardRealtimeEvents";
import { encodeBorrowBookSseEvent } from "@/lib/admin/realtime/borrowBookRealtimeEvents";
import { addAdminDashboardRealtimeListener } from "@/lib/admin/realtime/dashboardRealtimeBroker";

export async function GET(request: Request) {
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
        // Securely filter out admin dashboard events, only broadcasting public ones
        if (message.type === "BOOK_AVAILABILITY_UPDATED") {
          enqueue(encodeBorrowBookSseEvent(message));
        }
      });

      const keepAlive = setInterval(() => {
        enqueue(": keepalive\n\n");
      }, ADMIN_DASHBOARD_SSE_KEEPALIVE_MS);

      const close = () => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(keepAlive);
        request.signal.removeEventListener("abort", close);
        removeListener();
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
    },
  });
}
