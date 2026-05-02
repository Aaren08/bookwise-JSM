"use client";

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

type SessionEvent =
  | { type: "session:connected"; timestamp: string }
  | { type: "session:invalidated"; newRole: string; sessionVersion: number }
  | { type: "session:reconnect" }
  | { type: "session:error" };

const ENDPOINT = "/api/admin/session/realtime";
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export const useSessionInvalidation = () => {
  const router = useRouter();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MS);
  const destroyedRef = useRef(false);

  useEffect(() => {
    const connect = () => {
      if (destroyedRef.current) return;

      const es = new EventSource(ENDPOINT, { withCredentials: true });
      esRef.current = es;

      es.onmessage = async (event) => {
        let parsed: SessionEvent;
        try {
          parsed = JSON.parse(event.data) as SessionEvent;
        } catch {
          return;
        }

        if (parsed.type === "session:connected") {
          // Reset backoff on successful connection
          reconnectDelayRef.current = RECONNECT_DELAY_MS;
          return;
        }

        if (parsed.type === "session:invalidated") {
          // Sign out clears the JWT cookie; router.push lands them on sign-in
          es.close();
          await signOut({ redirect: false });
          router.push("/sign-in");
          return;
        }

        if (parsed.type === "session:reconnect") {
          // Server-initiated graceful reconnect (max lifetime hit)
          es.close();
          scheduleReconnect(0); // immediate reconnect, no backoff
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        scheduleReconnect(reconnectDelayRef.current);
        // Exponential backoff, capped
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * 2,
          MAX_RECONNECT_DELAY_MS,
        );
      };
    };

    const scheduleReconnect = (delay: number) => {
      if (destroyedRef.current) return;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      destroyedRef.current = true;
      esRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [router]);
};
