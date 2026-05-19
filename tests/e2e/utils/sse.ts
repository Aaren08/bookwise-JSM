import { Page, expect } from "@playwright/test";

export const ADMIN_DASHBOARD_SSE_URL = "/api/admin/dashboard/realtime";
export const ADMIN_REALTIME_ROWS_URL = "/api/admin/realtime/rows";

export function createSseInterceptorScript(): string {
  return `
    window.__SSE_EVENTS = [];
    window.__SSE_CONNECTIONS = [];

    const OrigEventSource = window.EventSource;

    window.EventSource = function(url, config) {
      const es = new OrigEventSource(url, config);
      const id = crypto.randomUUID();
      const urlStr = typeof url === 'string' ? url : url.toString();

      window.__SSE_CONNECTIONS.push({ id, url: urlStr, readyState: es.readyState });

      es.addEventListener('open', () => {
        const conn = window.__SSE_CONNECTIONS.find(c => c.id === id);
        if (conn) conn.readyState = es.readyState;
        window.__SSE_EVENTS.push({
          connectionId: id,
          type: 'open',
          url: urlStr,
          timestamp: new Date().toISOString()
        });
      });

      es.addEventListener('message', (event) => {
        let parsed;
        try { parsed = JSON.parse(event.data); }
        catch { parsed = event.data; }
        window.__SSE_EVENTS.push({
          connectionId: id,
          type: 'message',
          url: urlStr,
          data: parsed,
          rawData: event.data,
          timestamp: new Date().toISOString()
        });
      });

      es.addEventListener('error', () => {
        const conn = window.__SSE_CONNECTIONS.find(c => c.id === id);
        if (conn) conn.readyState = es.readyState;
        window.__SSE_EVENTS.push({
          connectionId: id,
          type: 'error',
          url: urlStr,
          timestamp: new Date().toISOString()
        });
      });

      return es;
    };

    window.EventSource.prototype = OrigEventSource.prototype;
    window.EventSource.CONNECTING = 0;
    window.EventSource.OPEN = 1;
    window.EventSource.CLOSED = 2;
  `;
}

export async function getSseEvents(page: Page): Promise<SSEEventRecord[]> {
  return page.evaluate(() => (window as unknown as { __SSE_EVENTS: SSEEventRecord[] }).__SSE_EVENTS || []);
}

export async function getSseConnections(page: Page): Promise<SSEConnectionRecord[]> {
  return page.evaluate(() => (window as unknown as { __SSE_CONNECTIONS: SSEConnectionRecord[] }).__SSE_CONNECTIONS || []);
}

export async function waitForSseEvent(
  page: Page,
  predicate: (event: SSEEventRecord) => boolean,
  timeout = 15_000,
) {
  await expect
    .poll(async () => {
      const events = await getSseEvents(page);
      return events.some(predicate);
    }, { timeout, message: `SSE event matching predicate not received within ${timeout}ms` })
    .toBe(true);
}

export async function waitForDashboardConnected(page: Page, timeout = 15_000) {
  await waitForSseEvent(
    page,
    (e) =>
      e.type === "message" &&
      e.url.includes("/api/admin/dashboard/realtime") &&
      typeof e.data === "object" &&
      e.data !== null &&
      (e.data as Record<string, unknown>).type === "dashboard:connected",
    timeout,
  );
}

export async function waitForDashboardRefresh(page: Page, timeout = 20_000) {
  await waitForSseEvent(
    page,
    (e) =>
      e.type === "message" &&
      e.url.includes("/api/admin/dashboard/realtime") &&
      typeof e.data === "object" &&
      e.data !== null &&
      (e.data as Record<string, unknown>).type === "dashboard:refresh",
    timeout,
  );
}

export function createNetworkDiagnostics(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("Failed to load resource")) return;
    if (text.includes("EventSource")) return;
    errors.push(`[CONSOLE:${msg.type()}] ${text}`);
  });

  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "unknown";
    const url = req.url();
    const expectedAbort =
      failure === "net::ERR_ABORTED" &&
      (url.includes("/_next/") ||
        url.includes("_rsc=") ||
        url.endsWith("/sign-in") ||
        url.includes("/api/book/stream"));
    if (!expectedAbort) {
      errors.push(`[NETWORK] ${url} (${failure})`);
    }
  });

  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !url.includes("/favicon") && !url.includes("/__nextjs")) {
      errors.push(`[HTTP ${status}] ${url}`);
    }
  });

  return errors;
}

export interface SSEEventRecord {
  connectionId: string;
  type: "open" | "message" | "error";
  url: string;
  data?: unknown;
  rawData?: string;
  timestamp: string;
}

export interface SSEConnectionRecord {
  id: string;
  url: string;
  readyState: number;
}
