import "server-only";

import redis from "@/database/redis";
import {
  ADMIN_DASHBOARD_REALTIME_CHANNEL,
  createDashboardRefreshMessage,
  isDashboardRealtimeMessage,
  type AdminDashboardRealtimeMessage,
} from "@/lib/admin/realtime/dashboardRealtimeEvents";

export type AdminDashboardRealtimeListener = (
  message: AdminDashboardRealtimeMessage,
) => void;

export type AdminDashboardRealtimeSubscription = ReturnType<
  typeof redis.subscribe
>;

export const publishAdminDashboardUpdate = async () => {
  const message = createDashboardRefreshMessage();

  await redis.publish(
    ADMIN_DASHBOARD_REALTIME_CHANNEL,
    JSON.stringify(message),
  );
};

export const subscribeToAdminDashboardUpdates = (
  onMessage: AdminDashboardRealtimeListener,
) => {
  const subscription = redis.subscribe([ADMIN_DASHBOARD_REALTIME_CHANNEL]);

  subscription.on("message", (data) => {
    try {
      const parsed =
        typeof data.message === "string"
          ? (JSON.parse(data.message) as unknown)
          : data.message;

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
