import "server-only";

import { WebSocket, WebSocketServer } from "ws";
import { DASHBOARD_WS_PORT } from "@/lib/admin/essentials/dashboardStatUtil";

declare global {
  var adminDashboardWss: WebSocketServer | undefined;
}

const createDashboardMessage = () =>
  JSON.stringify({
    type: "dashboard:refresh",
    timestamp: new Date().toISOString(),
  });

export const ensureAdminDashboardSocketServer = () => {
  if (typeof window !== "undefined") return null;

  if (globalThis.adminDashboardWss) {
    return globalThis.adminDashboardWss;
  }

  const wss = new WebSocketServer({
    host: "0.0.0.0",
    port: DASHBOARD_WS_PORT,
  });

  wss.on("error", (error) => {
    console.error("Admin dashboard websocket server error:", error);
  });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "dashboard:connected",
        timestamp: new Date().toISOString(),
      }),
    );
  });

  globalThis.adminDashboardWss = wss;

  return wss;
};

export const broadcastAdminDashboardUpdate = async () => {
  const wss = ensureAdminDashboardSocketServer();

  if (!wss) return;

  const message = createDashboardMessage();

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
};
