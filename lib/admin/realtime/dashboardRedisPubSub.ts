import "server-only";

import redis from "@/database/redis";
import {
  ADMIN_DASHBOARD_REALTIME_CHANNEL,
  createDashboardRefreshMessage,
  isDashboardRealtimeMessage,
  type AdminDashboardRealtimeMessage,
} from "@/lib/admin/realtime/dashboardRealtimeEvents";
import {
  BORROW_BOOK_REALTIME_CHANNEL,
  BORROW_BOOK_REALTIME_REPLAY_KEY,
  BORROW_BOOK_REALTIME_REPLAY_LIMIT,
  BORROW_BOOK_REALTIME_SEQUENCE_KEY,
  createBookUpdatedMessage,
  isBorrowBookRealtimeEvent,
  type BorrowBookRealtimeEvent,
  type BorrowBookRealtimeMessage,
} from "@/lib/admin/realtime/borrowBookRealtimeEvents";

export type AdminDashboardRealtimeListener = (
  message: AdminDashboardRealtimeMessage,
) => void;

export type AdminDashboardRealtimeSubscription = ReturnType<
  typeof redis.subscribe
>;

export type BorrowBookRealtimeSubscription = ReturnType<typeof redis.subscribe>;

const parsePubSubMessage = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  return JSON.parse(value) as unknown;
};

export const publishAdminDashboardUpdate = async () => {
  const message = createDashboardRefreshMessage();

  await redis.publish(
    ADMIN_DASHBOARD_REALTIME_CHANNEL,
    JSON.stringify(message),
  );
};

const publishBorrowBookRealtimeMessage = async (
  message: BorrowBookRealtimeMessage,
) => {
  const eventId = await redis.incr(BORROW_BOOK_REALTIME_SEQUENCE_KEY);
  const event: BorrowBookRealtimeEvent = {
    id: eventId,
    event: message.type,
    message,
    publishedAt: new Date().toISOString(),
  };

  await redis.rpush(BORROW_BOOK_REALTIME_REPLAY_KEY, JSON.stringify(event));
  await redis.ltrim(
    BORROW_BOOK_REALTIME_REPLAY_KEY,
    -BORROW_BOOK_REALTIME_REPLAY_LIMIT,
    -1,
  );
  await redis.publish(BORROW_BOOK_REALTIME_CHANNEL, JSON.stringify(event));

  return event;
};

export const publishBookAvailabilityUpdate = async (
  bookId: string,
  availableCount: number,
  reservedCount: number,
  borrowedCount: number,
) => {
  const message = createBookUpdatedMessage(
    bookId,
    availableCount,
    reservedCount,
    borrowedCount,
  );

  return publishBorrowBookRealtimeMessage(message);
};

export const getBorrowBookRealtimeReplay = async (lastEventId?: number) => {
  try {
    const replay = await redis.lrange<string>(BORROW_BOOK_REALTIME_REPLAY_KEY, 0, -1);

    return replay
      .map((entry) => {
        try {
          return parsePubSubMessage(entry);
        } catch (error) {
          console.error("Failed to parse replayable book realtime event:", error);
          return null;
        }
      })
      .filter(isBorrowBookRealtimeEvent)
      .filter((event) =>
        typeof lastEventId === "number" ? event.id > lastEventId : true,
      )
      .sort((left, right) => left.id - right.id);
  } catch (error) {
    console.error("Failed to load book realtime replay events:", error);
    return [];
  }
};

export const subscribeToBorrowBookUpdates = (
  onMessage: (event: BorrowBookRealtimeEvent) => void,
) => {
  const subscription = redis.subscribe([BORROW_BOOK_REALTIME_CHANNEL]);

  subscription.on("message", (data) => {
    try {
      const parsed = parsePubSubMessage(data.message);

      if (isBorrowBookRealtimeEvent(parsed)) {
        onMessage(parsed);
      }
    } catch (error) {
      console.error("Failed to parse book realtime message:", error);
    }
  });

  subscription.on("error", (error) => {
    console.error("Book realtime Redis subscription error:", error);
  });

  return subscription;
};

export const subscribeToAdminDashboardUpdates = (
  onMessage: AdminDashboardRealtimeListener,
) => {
  const subscription = redis.subscribe([ADMIN_DASHBOARD_REALTIME_CHANNEL]);

  subscription.on("message", (data) => {
    try {
      const parsed = parsePubSubMessage(data.message);

      if (isDashboardRealtimeMessage(parsed)) {
        onMessage(parsed);
      }
    } catch (error) {
      console.error("Failed to parse dashboard realtime message:", error);
    }
  });

  subscription.on("error", (error) => {
    console.error("Admin dashboard Redis subscription error:", error);
  });

  return subscription;
};
