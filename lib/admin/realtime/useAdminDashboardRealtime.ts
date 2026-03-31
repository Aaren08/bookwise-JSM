"use client";

import { useEffect, useRef, useState } from "react";
import {
  DASHBOARD_REALTIME_DELAY_MS,
  getAdminDashboardSocketUrl,
} from "@/lib/admin/essentials/dashboardStatUtil";

const DASHBOARD_API_ENDPOINT = "/api/admin/dashboard";
const RECONNECT_DELAY_MS = 2000;

export const useAdminDashboardRealtime = (
  initialSnapshot: AdminDashboardSnapshot,
) => {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  useEffect(() => {
    let isActive = true;
    let socket: WebSocket | null = null;

    const clearRefreshTimeout = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };

    const refreshSnapshot = async () => {
      try {
        const response = await fetch(DASHBOARD_API_ENDPOINT, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) return;

        const payload = (await response.json()) as {
          data?: AdminDashboardSnapshot;
        };

        if (isActive && payload.data) {
          setSnapshot(payload.data);
        }
      } catch (error) {
        console.error("Failed to refresh admin dashboard:", error);
      }
    };

    const queueRefresh = () => {
      clearRefreshTimeout();
      refreshTimeoutRef.current = setTimeout(() => {
        void refreshSnapshot();
      }, DASHBOARD_REALTIME_DELAY_MS);
    };

    const connect = () => {
      const url = getAdminDashboardSocketUrl();
      if (!url || !isActive) return;

      socket = new WebSocket(url);

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === "dashboard:refresh") {
            queueRefresh();
          }
        } catch (error) {
          console.error("Invalid admin dashboard websocket message:", error);
        }
      };

      socket.onclose = () => {
        if (!isActive) return;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      isActive = false;
      clearRefreshTimeout();

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      socket?.close();
    };
  }, []);

  return snapshot;
};
