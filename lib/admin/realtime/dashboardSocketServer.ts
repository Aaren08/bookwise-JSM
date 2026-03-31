import "server-only";

import { IncomingMessage } from "http";
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

const DASHBOARD_WS_SECRET = process.env.ADMIN_DASHBOARD_WS_SECRET;
const ALLOWED_DASHBOARD_ORIGINS = (process.env.ADMIN_DASHBOARD_WS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isOriginAllowed = (origin?: string) => {
  if (!origin) return true; // For non-browser clients or missing header
  if (ALLOWED_DASHBOARD_ORIGINS.length === 0) return true;
  return ALLOWED_DASHBOARD_ORIGINS.includes(origin);
};

export const ensureAdminDashboardSocketServer = () => {
  if (typeof window !== "undefined") return null;

  if (globalThis.adminDashboardWss) {
    return globalThis.adminDashboardWss;
  }

  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: DASHBOARD_WS_PORT,
  });

  wss.on("error", (error) => {
    console.error("Admin dashboard websocket server error:", error);
  });

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const origin = request.headers?.origin as string | undefined;
    const authHeader = request.headers?.authorization as string | undefined;
    const secretHeader = request.headers?.["x-admin-dashboard-secret"] as
      | string
      | undefined;
    const remoteAddr = request.socket?.remoteAddress ?? "";
    const url = new URL(
      request.url || "",
      `http://${request.headers.host || "dummy"}`,
    );
    const secretQuery = url.searchParams.get("admin_ws_secret");

    const ipAllowed =
      remoteAddr === "127.0.0.1" ||
      remoteAddr === "::1" ||
      remoteAddr === "0:0:0:0:0:0:0:1" ||
      remoteAddr === "::ffff:127.0.0.1";

    if (!ipAllowed) {
      console.warn(
        "Admin dashboard WS connection rejected: remote address not allowed",
        remoteAddr,
      );
      socket.close(1008, "Forbidden");
      return;
    }

    if (!isOriginAllowed(origin)) {
      console.warn(
        "Admin dashboard WS connection rejected: origin not allowed",
        origin,
      );
      socket.close(1008, "Forbidden");
      return;
    }

    const providedSecret = secretHeader || secretQuery;
    if (DASHBOARD_WS_SECRET && providedSecret !== DASHBOARD_WS_SECRET) {
      console.warn(
        "Admin dashboard WS connection rejected: invalid secret",
        origin,
      );
      socket.close(1008, "Forbidden");
      return;
    }

    // Optional Authorization header can be used for a second layer of control.
    if (
      DASHBOARD_WS_SECRET &&
      authHeader &&
      authHeader !== `Bearer ${DASHBOARD_WS_SECRET}`
    ) {
      console.warn(
        "Admin dashboard WS connection rejected: invalid auth header",
      );
      socket.close(1008, "Forbidden");
      return;
    }

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
