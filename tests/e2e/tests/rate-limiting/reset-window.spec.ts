import { test, expect } from "@playwright/test";
import {
  resetRateLimitStateForIp,
  resetSseConnectionLeases,
  resetReceiptRateLimit,
  resetRateLimitCacheViaApi,
  ANONYMOUS_SSE_CONNECTION_LIMIT,
} from "../../utils/rate-limit";
import {
  browserPost,
  browserPostSequential,
} from "../../utils/browser-fetch";
import { SigninPage } from "../../pages/auth/signin.page";
import { testUsers } from "../../config/users";

const CONNECTION_TIMEOUT = 5_000;
const SSE_STREAM_URL = "/api/book/stream?bookId=e2e-reset-sse-lease";

test.describe("Rate Limiting — Reset Windows", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.0.3" } });

  test.beforeEach(async ({ request }) => {
    await resetRateLimitStateForIp("10.0.0.3");
    await resetRateLimitCacheViaApi(request, "10.0.0.3");
    await resetSseConnectionLeases("10.0.0.3");
    await resetReceiptRateLimit("e2e-reset-window-test");
    await resetReceiptRateLimit("e2e-cross-user-reset");
  });

  test("receipt API rate limit resets via test endpoint", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const signinPage = new SigninPage(page);
    await signinPage.goto();
    await signinPage.signIn(
      testUsers.standardUser.email,
      testUsers.standardUser.password,
    );

    const receiptId = "e2e-reset-window-test";

    // Exhaust the rate limit (5/min) — use sequential requests
    const results = await browserPostSequential(
      page,
      "/api/receipt/download",
      { receiptId },
      5,
    );
    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // 6th request should be rate limited
    const rateLimited = await browserPost(page, "/api/receipt/download", { receiptId });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.data).toHaveProperty("error");

    // Reset via test endpoint (clears both Redis keys AND in-memory cache)
    await browserPost(page, "/api/test/reset-rate-limit", {
      limiter: "receipt:minute",
      receiptId,
    });
    await browserPost(page, "/api/test/reset-rate-limit", {
      limiter: "receipt:daily",
      receiptId,
    });

    // After reset via the proper endpoint, a new request should succeed
    const afterReset = await browserPost<{ allowed: boolean }>(page, "/api/receipt/download", { receiptId });
    expect(afterReset.status).toBe(200);
    expect(afterReset.data.allowed).toBe(true);
  });

  test("new rate limit window opens after reset for SSE connection lease", async ({
    page,
  }) => {
    await page.goto("/");

    // Open all connections simultaneously to test the lease limit
    const connections = await page.evaluate(
      ({ url, limit, timeout }) => {
        // Open limit + 1 connections concurrently
        return Promise.all(
          Array.from({ length: limit + 1 }, (_, i) => {
            return new Promise<{ success: boolean; index: number }>(
              (resolve) => {
                const es = new EventSource(`${url}&_idx=${i}`);
                const timer = setTimeout(() => {
                  es.close();
                  resolve({ success: false, index: i });
                }, timeout);

                es.onopen = () => {
                  clearTimeout(timer);
                  // Keep connections alive to occupy lease slots
                  resolve({ success: true, index: i });
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

    const successful = connections.filter((c) => c.success);
    const rejected = connections.filter((c) => !c.success);

    // At most ANONYMOUS_SSE_CONNECTION_LIMIT should succeed
    expect(successful.length).toBeLessThanOrEqual(ANONYMOUS_SSE_CONNECTION_LIMIT);
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    // Navigate away to close all SSE connections
    await page.goto("/");

    // Reset the SSE connection leases
    await resetSseConnectionLeases("10.0.0.3");

    // Can now open a new connection
    const afterReset = await page.evaluate(
      ({ url, timeout }) => {
        return new Promise<{ success: boolean }>((resolve) => {
          const es = new EventSource(`${url}&_idx=after`);
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
    expect(afterReset.success).toBe(true);
  });

  test("rate limit state resets across users after IP-based reset", async ({
    page,
  }) => {
    const signinPage = new SigninPage(page);
    await signinPage.goto();
    await signinPage.signIn(
      testUsers.standardUser.email,
      testUsers.standardUser.password,
    );

    // Make requests that exhaust part of the rate limit
    const receiptId = "e2e-cross-user-reset";
    await browserPostSequential(page, "/api/receipt/download", { receiptId }, 3);

    // Reset all rate limit state for the test IP
    await resetRateLimitStateForIp("10.0.0.3");
    await resetRateLimitCacheViaApi(page.request, "10.0.0.3");

    // Now requests should work again
    const afterReset = await browserPost<{ allowed: boolean }>(page, "/api/receipt/download", { receiptId });
    expect(afterReset.status).toBe(200);
    expect(afterReset.data.allowed).toBe(true);
  });
});
