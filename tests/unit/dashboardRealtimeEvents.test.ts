import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createDashboardConnectedMessage,
  createDashboardRefreshMessage,
  isDashboardRealtimeMessage,
  encodeDashboardSseEvent,
  ADMIN_DASHBOARD_REALTIME_CHANNEL,
  ADMIN_DASHBOARD_SSE_ENDPOINT,
  ADMIN_DASHBOARD_SSE_RETRY_MS,
  ADMIN_DASHBOARD_SSE_KEEPALIVE_MS,
  ADMIN_DASHBOARD_SSE_MAX_LIFETIME_MS,
} from "@/lib/admin/realtime/broadcast/dashboardRealtimeEvents";

describe("createDashboardConnectedMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
  });

  it("creates a dashboard:connected message with current timestamp", () => {
    const result = createDashboardConnectedMessage();

    expect(result).toEqual({
      type: "dashboard:connected",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
  });

  it("uses the system time at call time", () => {
    vi.setSystemTime(new Date("2027-06-15T08:30:00.000Z"));

    const result = createDashboardConnectedMessage();

    expect(result.timestamp).toBe("2027-06-15T08:30:00.000Z");
  });
});

describe("createDashboardRefreshMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
  });

  it("creates a dashboard:refresh message with current timestamp", () => {
    const result = createDashboardRefreshMessage();

    expect(result).toEqual({
      type: "dashboard:refresh",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
  });
});

describe("isDashboardRealtimeMessage", () => {
  it("returns true for dashboard:connected message", () => {
    expect(
      isDashboardRealtimeMessage({
        type: "dashboard:connected",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("returns true for dashboard:refresh message", () => {
    expect(
      isDashboardRealtimeMessage({
        type: "dashboard:refresh",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("returns false for null", () => {
    expect(isDashboardRealtimeMessage(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDashboardRealtimeMessage(undefined)).toBe(false);
  });

  it("returns false for non-object values", () => {
    expect(isDashboardRealtimeMessage("string")).toBe(false);
    expect(isDashboardRealtimeMessage(42)).toBe(false);
    expect(isDashboardRealtimeMessage(true)).toBe(false);
  });

  it("returns false for an unknown message type", () => {
    expect(
      isDashboardRealtimeMessage({
        type: "unknown:event",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("returns false when timestamp is not a string", () => {
    expect(
      isDashboardRealtimeMessage({
        type: "dashboard:connected",
        timestamp: 123,
      }),
    ).toBe(false);
  });

  it("returns false when timestamp is missing", () => {
    expect(
      isDashboardRealtimeMessage({
        type: "dashboard:connected",
      }),
    ).toBe(false);
  });

  it("returns false when message type is missing", () => {
    expect(
      isDashboardRealtimeMessage({
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isDashboardRealtimeMessage([])).toBe(false);
  });
});

describe("encodeDashboardSseEvent", () => {
  it("encodes a dashboard:connected message to SSE format", () => {
    const result = encodeDashboardSseEvent({
      type: "dashboard:connected",
      timestamp: "2026-05-24T12:00:00.000Z",
    });

    expect(result).toBe(
      'data: {"type":"dashboard:connected","timestamp":"2026-05-24T12:00:00.000Z"}\n\n',
    );
  });

  it("encodes a dashboard:refresh message to SSE format", () => {
    const result = encodeDashboardSseEvent({
      type: "dashboard:refresh",
      timestamp: "2026-06-01T00:00:00.000Z",
    });

    expect(result).toBe(
      'data: {"type":"dashboard:refresh","timestamp":"2026-06-01T00:00:00.000Z"}\n\n',
    );
  });

  it("always ends with double newline", () => {
    const result = encodeDashboardSseEvent({
      type: "dashboard:connected",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toMatch(/\n\n$/);
  });
});

describe("module constants", () => {
  it("defines ADMIN_DASHBOARD_REALTIME_CHANNEL", () => {
    expect(ADMIN_DASHBOARD_REALTIME_CHANNEL).toBe(
      "admin-dashboard:analytics-refresh",
    );
  });

  it("defines ADMIN_DASHBOARD_SSE_ENDPOINT", () => {
    expect(ADMIN_DASHBOARD_SSE_ENDPOINT).toBe("/api/admin/dashboard/realtime");
  });

  it("defines ADMIN_DASHBOARD_SSE_RETRY_MS as 2000", () => {
    expect(ADMIN_DASHBOARD_SSE_RETRY_MS).toBe(2000);
  });

  it("defines ADMIN_DASHBOARD_SSE_KEEPALIVE_MS as 15000", () => {
    expect(ADMIN_DASHBOARD_SSE_KEEPALIVE_MS).toBe(15_000);
  });

  it("defines ADMIN_DASHBOARD_SSE_MAX_LIFETIME_MS as 5 minutes", () => {
    expect(ADMIN_DASHBOARD_SSE_MAX_LIFETIME_MS).toBe(5 * 60 * 1000);
  });
});
