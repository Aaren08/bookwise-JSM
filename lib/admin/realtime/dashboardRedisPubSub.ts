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
} from "@/lib/admin/realtime/concurrency/borrowBookRealtimeEvents";

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
  const eventJson = await redis.eval(
    `
    local id = redis.call('INCR', KEYS[1])
    local message = cjson.decode(ARGV[1])
    local event = {
      id = id,
      event = ARGV[2],
      message = message,
      publishedAt = ARGV[3]
    }
    local eventJson = cjson.encode(event)
    redis.call('RPUSH', KEYS[2], eventJson)
    redis.call('LTRIM', KEYS[2], -tonumber(ARGV[4]), -1)
    redis.call('PUBLISH', KEYS[3], eventJson)
    return eventJson
    `,
    [
      BORROW_BOOK_REALTIME_SEQUENCE_KEY,
      BORROW_BOOK_REALTIME_REPLAY_KEY,
      BORROW_BOOK_REALTIME_CHANNEL,
    ],
    [
      JSON.stringify(message),
      message.type,
      new Date().toISOString(),
      BORROW_BOOK_REALTIME_REPLAY_LIMIT,
    ],
  );

  try {
    const parsed =
      typeof eventJson === "string" ? JSON.parse(eventJson) : eventJson;

    if (isBorrowBookRealtimeEvent(parsed)) {
      return parsed;
    }

    console.error(
      "Invalid book realtime event shape returned from redis.eval:",
      parsed,
    );
    throw new Error("Invalid book realtime event shape returned from Redis");
  } catch (error) {
    console.error(
      "Failed to parse or validate book realtime event from redis.eval:",
      error,
    );
    throw error;
  }
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
    const replay = await redis.lrange<string>(
      BORROW_BOOK_REALTIME_REPLAY_KEY,
      0,
      -1,
    );

    return replay
      .map((entry) => {
        try {
          return parsePubSubMessage(entry);
        } catch (error) {
          console.error(
            "Failed to parse replayable book realtime event:",
            error,
          );
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
