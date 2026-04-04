export const ADMIN_DASHBOARD_REALTIME_CHANNEL =
  "admin-dashboard:analytics-refresh";

export const ADMIN_DASHBOARD_SSE_ENDPOINT = "/api/admin/dashboard/realtime";
export const ADMIN_DASHBOARD_SSE_RETRY_MS = 2000;
export const ADMIN_DASHBOARD_SSE_KEEPALIVE_MS = 25_000;

export type AdminDashboardRealtimeMessage =
  | {
      type: "dashboard:connected";
      timestamp: string;
    }
  | {
      type: "dashboard:refresh";
      timestamp: string;
    };

export const createDashboardConnectedMessage =
  (): AdminDashboardRealtimeMessage => ({
    type: "dashboard:connected",
    timestamp: new Date().toISOString(),
  });

export const createDashboardRefreshMessage =
  (): AdminDashboardRealtimeMessage => ({
    type: "dashboard:refresh",
    timestamp: new Date().toISOString(),
  });

export const isDashboardRealtimeMessage = (
  value: unknown,
): value is AdminDashboardRealtimeMessage => {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;

  return (
    (message.type === "dashboard:connected" ||
      message.type === "dashboard:refresh") &&
    typeof message.timestamp === "string"
  );
};

export const encodeDashboardSseEvent = (
  message: AdminDashboardRealtimeMessage,
) => `data: ${JSON.stringify(message)}\n\n`;
