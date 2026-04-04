import "server-only";

import {
  subscribeToAdminDashboardUpdates,
  type AdminDashboardRealtimeListener,
  type AdminDashboardRealtimeSubscription,
} from "@/lib/admin/realtime/dashboardRedisPubSub";
import { type AdminDashboardRealtimeMessage } from "@/lib/admin/realtime/dashboardRealtimeEvents";

const ADMIN_DASHBOARD_SUBSCRIPTION_IDLE_MS = 30_000;

type DashboardRealtimeBrokerState = {
  listeners: Set<AdminDashboardRealtimeListener>;
  subscription: AdminDashboardRealtimeSubscription | null;
  idleTimeout: ReturnType<typeof setTimeout> | null;
};

declare global {
  var adminDashboardRealtimeBroker: DashboardRealtimeBrokerState | undefined;
}

const getBrokerState = (): DashboardRealtimeBrokerState => {
  if (!globalThis.adminDashboardRealtimeBroker) {
    globalThis.adminDashboardRealtimeBroker = {
      listeners: new Set(),
      subscription: null,
      idleTimeout: null,
    };
  }

  return globalThis.adminDashboardRealtimeBroker;
};

const broadcastToInstanceListeners = (
  message: AdminDashboardRealtimeMessage,
  listeners: Set<AdminDashboardRealtimeListener>,
) => {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch (error) {
      console.error("Admin dashboard realtime listener failed:", error);
    }
  }
};

const ensureRedisSubscription = (state: DashboardRealtimeBrokerState) => {
  if (state.subscription) return;

  state.subscription = subscribeToAdminDashboardUpdates((message) => {
    broadcastToInstanceListeners(message, state.listeners);
  });
};

const clearIdleCleanup = (state: DashboardRealtimeBrokerState) => {
  if (!state.idleTimeout) return;

  clearTimeout(state.idleTimeout);
  state.idleTimeout = null;
};

const scheduleIdleCleanup = (state: DashboardRealtimeBrokerState) => {
  clearIdleCleanup(state);

  state.idleTimeout = setTimeout(() => {
    if (state.listeners.size > 0 || !state.subscription) return;

    const subscription = state.subscription;
    state.subscription = null;
    state.idleTimeout = null;

    void subscription.unsubscribe().catch((error) => {
      console.error(
        "Failed to close idle admin dashboard Redis subscription:",
        error,
      );
    });
  }, ADMIN_DASHBOARD_SUBSCRIPTION_IDLE_MS);
};

export const addAdminDashboardRealtimeListener = (
  listener: AdminDashboardRealtimeListener,
) => {
  const state = getBrokerState();

  clearIdleCleanup(state);
  state.listeners.add(listener);
  ensureRedisSubscription(state);

  return () => {
    state.listeners.delete(listener);

    if (state.listeners.size === 0) {
      scheduleIdleCleanup(state);
    }
  };
};
