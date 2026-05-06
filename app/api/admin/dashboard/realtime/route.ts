import { auth } from "@/auth";
import {
  ADMIN_DASHBOARD_SSE_KEEPALIVE_MS,
  ADMIN_DASHBOARD_SSE_RETRY_MS,
  createDashboardConnectedMessage,
  encodeDashboardSseEvent,
} from "@/lib/admin/realtime/broadcast/dashboardRealtimeEvents";
import { addAdminDashboardRealtimeListener } from "@/lib/admin/realtime/broadcast/dashboardRealtimeBroker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;

      const enqueue = (payload: string) => {
        if (isClosed) return;
        controller.enqueue(encoder.encode(payload));
      };

      enqueue(`retry: ${ADMIN_DASHBOARD_SSE_RETRY_MS}\n\n`);
      enqueue(encodeDashboardSseEvent(createDashboardConnectedMessage()));

      const removeListener = addAdminDashboardRealtimeListener((message) => {
        enqueue(encodeDashboardSseEvent(message));
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
