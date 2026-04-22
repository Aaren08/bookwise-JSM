export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import {
  ADMIN_DASHBOARD_SSE_KEEPALIVE_MS,
  ADMIN_DASHBOARD_SSE_RETRY_MS,
} from "@/lib/admin/realtime/dashboardRealtimeEvents";
import { encodeBorrowBookSseEvent } from "@/lib/admin/realtime/borrowBookRealtimeEvents";
import {
  getBorrowBookRealtimeReplay,
  subscribeToBorrowBookUpdates,
} from "@/lib/admin/realtime/dashboardRedisPubSub";
import {
  acquireSseConnectionLease,
  anonymousSseConnectRateLimit,
  authenticatedSseConnectRateLimit,
  createRateLimitHeaders,
  getRateLimitIdentity,
  releaseSseConnectionLease,
  refreshSseConnectionLease,
  safeRateLimit,
} from "@/lib/essentials/rateLimit";

const CLOSE_EVENT = "event: stream.close\ndata: {\"reason\":\"server_disconnect\"}\n\n";

const parseLastEventId = (request: Request) => {
  const rawValue = request.headers.get("last-event-id");

  if (!rawValue) return null;

  const parsed = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(request: Request) {
  const session = await auth();
  const identity = getRateLimitIdentity(request, session?.user?.id);
  const rateLimitClient =
    identity.kind === "user"
      ? authenticatedSseConnectRateLimit
      : anonymousSseConnectRateLimit;
  const rateLimitResult = await safeRateLimit(rateLimitClient, identity.key);

  if (!rateLimitResult.success) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: createRateLimitHeaders(rateLimitResult),
    });
  }

  const lease = await acquireSseConnectionLease(identity);

  if (!lease.success) {
    return new Response("Too Many Open Streams", {
      status: 429,
      headers: {
        "Retry-After": "30",
        "X-Connection-Limit": String(lease.limit),
      },
    });
  }

  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId");
  const lastEventId = parseLastEventId(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;
      let highestDeliveredEventId = lastEventId ?? 0;
      const bufferedLiveEvents: Awaited<
        ReturnType<typeof getBorrowBookRealtimeReplay>
      > = [];
      let replayFinished = false;

      const enqueue = (payload: string) => {
        if (isClosed) return;
        controller.enqueue(encoder.encode(payload));
      };

      const matchesFilter = (eventBookId: string) =>
        !bookId || eventBookId === bookId;

      const sendEvent = (
        event: (typeof bufferedLiveEvents)[number],
      ) => {
        if (!matchesFilter(event.message.bookId)) return;
        if (event.id <= highestDeliveredEventId) return;

        highestDeliveredEventId = event.id;
        enqueue(encodeBorrowBookSseEvent(event));
      };

      const subscription = subscribeToBorrowBookUpdates((event) => {
        if (replayFinished) {
          sendEvent(event);
          return;
        }

        bufferedLiveEvents.push(event);
      });

      const keepAlive = setInterval(() => {
        enqueue(": keepalive\n\n");
        void refreshSseConnectionLease(lease.key);
      }, ADMIN_DASHBOARD_SSE_KEEPALIVE_MS);

      const close = () => {
        if (isClosed) return;

        isClosed = true;
        clearInterval(keepAlive);
        request.signal.removeEventListener("abort", close);
        void subscription.unsubscribe().catch((error) => {
          console.error("Failed to unsubscribe book realtime stream:", error);
        });
        void releaseSseConnectionLease(lease.key);

        try {
          controller.close();
        } catch {
          // Stream is already closed.
        }
      };

      request.signal.addEventListener("abort", close);

      enqueue(`retry: ${ADMIN_DASHBOARD_SSE_RETRY_MS}\n\n`);

      try {
        const replayEvents = await getBorrowBookRealtimeReplay(
          highestDeliveredEventId > 0 ? highestDeliveredEventId : undefined,
        );

        for (const event of replayEvents) {
          sendEvent(event);
        }
      } catch (error) {
        console.error("Failed while bootstrapping book realtime stream:", error);
      } finally {
        replayFinished = true;

        bufferedLiveEvents
          .sort((left, right) => left.id - right.id)
          .forEach((event) => {
            sendEvent(event);
          });
      }

      subscription.on("error", () => {
        enqueue(CLOSE_EVENT);
        close();
      });
    },
    cancel() {
      // The abort listener above handles cleanup.
    },
  });

  return new Response(stream, {
    headers: {
      ...createRateLimitHeaders(rateLimitResult),
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
