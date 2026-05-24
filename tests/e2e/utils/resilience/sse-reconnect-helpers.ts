import { Page, expect } from "@playwright/test";
import {
  getSseConnections,
  getSseEvents,
  ADMIN_DASHBOARD_SSE_URL,
} from "../sse";

export interface SseReconnectStats {
  totalConnections: number;
  uniqueUrls: number;
  errorEvents: number;
  openEvents: number;
  activeConnections: number;
  duplicateUrls: string[];
}

export async function getSseReconnectStats(
  page: Page,
): Promise<SseReconnectStats> {
  const connections = await getSseConnections(page);
  const events = await getSseEvents(page);

  const urls = connections.map((c) => c.url);
  const uniqueUrls = [...new Set(urls)];
  const dupes = uniqueUrls.filter(
    (u) => urls.filter((x) => x === u).length > 1,
  );

  return {
    totalConnections: connections.length,
    uniqueUrls: uniqueUrls.length,
    errorEvents: events.filter((e) => e.type === "error").length,
    openEvents: events.filter((e) => e.type === "open").length,
    activeConnections: connections.filter((c) => c.readyState === 1).length,
    duplicateUrls: dupes,
  };
}

export async function assertNoDuplicateSseSubscriptions(
  page: Page,
  sseUrl: string = ADMIN_DASHBOARD_SSE_URL,
  maxAllowed = 3,
): Promise<void> {
  const connections = await getSseConnections(page);
  const dashboardConns = connections.filter((c) => c.url.includes(sseUrl));
  expect(
    dashboardConns.length,
    `Expected ≤${maxAllowed} SSE connections to ${sseUrl}, got ${dashboardConns.length}`,
  ).toBeLessThanOrEqual(maxAllowed);
}

export async function waitForSseReconnected(
  page: Page,
  sseUrl: string = ADMIN_DASHBOARD_SSE_URL,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const connections = await getSseConnections(page);
        return connections.some(
          (c) => c.url.includes(sseUrl) && c.readyState === 1,
        );
      },
      {
        timeout,
        message: `SSE to ${sseUrl} did not reconnect within ${timeout}ms`,
      },
    )
    .toBe(true);
}

export async function terminateSseAndWaitForReconnect(
  page: Page,
  sseEndpoint: string,
  restoreDelayMs: number,
): Promise<void> {
  await page.route(sseEndpoint, (route) => {
    route.abort("connectionrefused");
  });

  await page.waitForTimeout(restoreDelayMs);

  await page.unroute(sseEndpoint);
}

export async function getSseEventCountByType(
  page: Page,
  eventType: string,
  sseUrl?: string,
): Promise<number> {
  const events = await getSseEvents(page);
  return events.filter(
    (e) => e.type === eventType && (sseUrl ? e.url.includes(sseUrl) : true),
  ).length;
}

export async function assertSseReconnectBackoff(
  page: Page,
  sseUrl: string = ADMIN_DASHBOARD_SSE_URL,
  timeout = 60_000,
): Promise<void> {
  const startTime = Date.now();
  const intervals: number[] = [];
  let lastEventCount = 0;

  while (Date.now() - startTime < timeout) {
    const events = await getSseEvents(page);
    const errorEvents = events.filter(
      (e) => e.type === "error" && e.url.includes(sseUrl),
    );

    if (errorEvents.length > lastEventCount) {
      if (lastEventCount > 0) {
        intervals.push(Date.now() - startTime);
      }
      lastEventCount = errorEvents.length;
    }

    const connected = await getSseConnections(page);
    const active = connected.some(
      (c) => c.url.includes(sseUrl) && c.readyState === 1,
    );

    if (active) break;

    await page.waitForTimeout(500);
  }

  if (intervals.length >= 2) {
    const averageInterval =
      intervals.reduce((a, b) => a + b, 0) / intervals.length;
    expect(averageInterval).toBeGreaterThan(0);
  }
}

export async function ensureSingleActiveConnection(
  page: Page,
  sseUrl: string = ADMIN_DASHBOARD_SSE_URL,
): Promise<void> {
  const connections = await getSseConnections(page);
  const targetConns = connections.filter((c) => c.url.includes(sseUrl));
  const active = targetConns.filter((c) => c.readyState === 1);
  expect(
    active.length,
    `Expected exactly 1 active SSE connection to ${sseUrl}, got ${active.length}`,
  ).toBeLessThanOrEqual(1);
}
