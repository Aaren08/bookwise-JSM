import { test, expect } from "@playwright/test";
import {
  resetRateLimitStateForIp,
  resetSseConnectionLeases,
  resetRateLimitCacheViaApi,
  ANONYMOUS_SSE_CONNECTION_LIMIT,
} from "../../utils/rate-limit";

const SSE_STREAM_URL = "/api/book/stream?bookId=e2e-rate-limit-sse-test";
const CONNECTION_TIMEOUT = 10_000;

type WindowWithActiveStreams = Window & {
  __active_streams?: EventSource[];
};

test.describe("Rate Limiting — SSE Stream Limits", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.0.4" } });

  test.beforeEach(async ({ request }) => {
    await resetRateLimitStateForIp("10.0.0.4");
    await resetRateLimitCacheViaApi(request, "10.0.0.4");
    await resetSseConnectionLeases("10.0.0.4");
  });

  test("rejects new EventSource connections beyond the anonymous lease limit", async ({
    page,
  }) => {
    const sseStatuses: { url: string; status: number }[] = [];

    page.on("response", (response) => {
      if (response.url().includes("/api/book/stream")) {
        sseStatuses.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    await page.goto("/");

    // Open all connections simultaneously to test the lease limit
    // Keep connections alive to occupy lease slots
    const openResults = await page.evaluate(
      ({ url, limit, timeout }) => {
        return Promise.all(
          Array.from({ length: limit + 2 }, (_, i) => {
            return new Promise<{ success: boolean; index: number }>(
              (resolve) => {
                const es = new EventSource(`${url}&_idx=${i}`);
                const activeWindow = window as WindowWithActiveStreams;
                activeWindow.__active_streams =
                  activeWindow.__active_streams ?? [];
                activeWindow.__active_streams.push(es);
                const timer = setTimeout(() => {
                  es.close();
                  resolve({ success: false, index: i });
                }, timeout);

                es.onopen = () => {
                  clearTimeout(timer);
                  resolve({ success: true, index: i });
                  // DO NOT close — keep alive to occupy the lease slot
                };

                es.onerror = () => {
                  clearTimeout(timer);
                  es.close();
                  resolve({ success: false, index: i });
                };
              },
            );
          }),
        );
      },
      {
        url: SSE_STREAM_URL,
        limit: ANONYMOUS_SSE_CONNECTION_LIMIT,
        timeout: CONNECTION_TIMEOUT,
      },
    );

    const successful = openResults.filter((r) => r.success);
    const rejected = openResults.filter((r) => !r.success);

    expect(successful.length).toBeLessThanOrEqual(ANONYMOUS_SSE_CONNECTION_LIMIT);
    expect(rejected.length).toBeGreaterThanOrEqual(2);

    const rejectedResponses = sseStatuses.filter((s) => s.status === 429);
    expect(rejectedResponses.length).toBeGreaterThanOrEqual(1);
  });

  test("existing SSE streams continue functioning after new streams are rejected", async ({
    page,
  }) => {
    const sseStatuses: { url: string; status: number }[] = [];

    page.on("response", (response) => {
      if (response.url().includes("/api/book/stream")) {
        sseStatuses.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    await page.goto("/");

    // Open connections up to the limit simultaneously
    const initialResults = await page.evaluate(
      ({ url, limit, timeout }) => {
        return Promise.all(
          Array.from({ length: limit }, (_, i) => {
            return new Promise<{ success: boolean; index: number }>(
              (resolve) => {
                const es = new EventSource(`${url}&_idx=initial-${i}`);
                const activeWindow = window as WindowWithActiveStreams;
                activeWindow.__active_streams =
                  activeWindow.__active_streams ?? [];
                activeWindow.__active_streams.push(es);
                const timer = setTimeout(() => {
                  es.close();
                  resolve({ success: false, index: i });
                }, timeout);

                es.onopen = () => {
                  clearTimeout(timer);
                  resolve({ success: true, index: i });
                  // Keep alive to occupy lease slots
                };

                es.onerror = () => {
                  clearTimeout(timer);
                  es.close();
                  resolve({ success: false, index: i });
                };
              },
            );
          }),
        );
      },
      {
        url: SSE_STREAM_URL,
        limit: ANONYMOUS_SSE_CONNECTION_LIMIT,
        timeout: CONNECTION_TIMEOUT,
      },
    );

    for (const r of initialResults) {
      expect(r.success).toBe(true);
    }

    // Try opening an additional connection — should be rejected
    const rejected = await page.evaluate(
      ({ url, timeout }) => {
        return new Promise<{ success: boolean }>((resolve) => {
          const es = new EventSource(`${url}&_idx=rejected`);
          const activeWindow = window as WindowWithActiveStreams;
          activeWindow.__active_streams = activeWindow.__active_streams ?? [];
          activeWindow.__active_streams.push(es);
          const timer = setTimeout(() => {
            es.close();
            resolve({ success: false });
          }, timeout);

          es.onopen = () => {
            clearTimeout(timer);
            resolve({ success: true });
            es.close();
          };

          es.onerror = () => {
            clearTimeout(timer);
            resolve({ success: false });
            es.close();
          };
        });
      },
      { url: SSE_STREAM_URL, timeout: CONNECTION_TIMEOUT },
    );
    expect(rejected.success).toBe(false);

    // Navigate away to close all SSE connections
    await page.goto("/");
  });

  test("SSE rate-limited responses include x-ratelimit-limit header", async ({
    page,
  }) => {
    const rateLimitedHeaders: Record<string, string>[] = [];

    page.on("response", (resp) => {
      if (resp.url().includes("/api/book/stream") && resp.status() === 429) {
        rateLimitedHeaders.push(resp.headers());
      }
    });

    await page.goto("/");

    // Cycle through connections to hit the SSE connect rate limit (12/min for anonymous)
    for (let cycle = 0; cycle < 8; cycle++) {
      await Promise.all(
        [0, 1].map((i) =>
          page.evaluate(
            ({ c, j, timeout }) => {
              return new Promise<void>((resolve) => {
                const es = new EventSource(
                  `/api/book/stream?bookId=e2e-sse-header-test&cycle=${c}&i=${j}`,
                );
                const timer = setTimeout(() => {
                  es.close();
                  resolve();
                }, timeout);

                es.onopen = () => {
                  clearTimeout(timer);
                  es.close();
                  resolve();
                };

                es.onerror = () => {
                  clearTimeout(timer);
                  es.close();
                  resolve();
                };
              });
            },
            { c: cycle, j: i, timeout: 3000 },
          ),
        ),
      );

      const headerResponse = rateLimitedHeaders.find(
        (h) => h["x-ratelimit-limit"] !== undefined,
      );
      if (headerResponse) break;
    }

    const headerResponse = rateLimitedHeaders.find(
      (h) => h["x-ratelimit-limit"] !== undefined,
    );
    expect(headerResponse).toBeDefined();
    expect(Number(headerResponse!["x-ratelimit-limit"])).toBeGreaterThan(0);

    const retryAfter = headerResponse!["retry-after"];
    if (retryAfter) {
      expect(Number(retryAfter)).toBeGreaterThan(0);
    }
  });
});
