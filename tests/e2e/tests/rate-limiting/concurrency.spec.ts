import { test, expect } from "@playwright/test";
import {
  resetRateLimitStateForIp,
  resetReceiptRateLimit,
  resetRateLimitCacheViaApi,
} from "../../utils/rate-limit";
import {
  browserPostConcurrent,
  browserPost,
} from "../../utils/browser-fetch";
import { SigninPage } from "../../pages/auth/signin.page";
import { testUsers } from "../../config/users";

test.describe("Rate Limiting — Concurrency", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.0.2" } });

  test.beforeEach(async ({ request }) => {
    await resetRateLimitStateForIp("10.0.0.2");
    await resetRateLimitCacheViaApi(request, "10.0.0.2");
    await resetReceiptRateLimit("e2e-concurrent-burst-test");
    await resetReceiptRateLimit("e2e-batched-concurrent-test");
    await resetReceiptRateLimit("e2e-consistent-rejection-test");
    await resetReceiptRateLimit("e2e-isolated-receipt-a");
    await resetReceiptRateLimit("e2e-isolated-receipt-b");
  });

  test("burst of concurrent receipt download requests triggers consistent rate limiting", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const signinPage = new SigninPage(page);
    await signinPage.goto();
    await signinPage.signIn(
      testUsers.standardUser.email,
      testUsers.standardUser.password,
    );

    const receiptId = "e2e-concurrent-burst-test";

    const results = await browserPostConcurrent(
      page,
      "/api/receipt/download",
      { receiptId },
      15,
    );

    const successful = results.filter((r) => r.status === 200);
    const rateLimited = results.filter((r) => r.status === 429);

    expect(successful.length).toBeGreaterThanOrEqual(1);
    expect(successful.length).toBeLessThanOrEqual(6);
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);

    for (const r of rateLimited) {
      expect(r.data).toHaveProperty("error");
    }
  });

  test("batched concurrent requests enforce rate limit across batches", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const signinPage = new SigninPage(page);
    await signinPage.goto();
    await signinPage.signIn(
      testUsers.standardUser.email,
      testUsers.standardUser.password,
    );

    const receiptId = "e2e-batched-concurrent-test";

    // Batch 1: 5 concurrent
    const batch1 = await browserPostConcurrent(
      page,
      "/api/receipt/download",
      { receiptId },
      5,
    );

    // Batch 2: 5 more concurrent
    const batch2 = await browserPostConcurrent(
      page,
      "/api/receipt/download",
      { receiptId },
      5,
    );

    // Batch 3: 5 more concurrent
    const batch3 = await browserPostConcurrent(
      page,
      "/api/receipt/download",
      { receiptId },
      5,
    );

    const allResults = [...batch1, ...batch2, ...batch3];

    const rateLimited = allResults.filter((r) => r.status === 429);
    const successful = allResults.filter((r) => r.status === 200);

    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
    expect(successful.length).toBeGreaterThanOrEqual(1);
  });

  test("all requests are consistently rejected after threshold under parallel load", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const signinPage = new SigninPage(page);
    await signinPage.goto();
    await signinPage.signIn(
      testUsers.standardUser.email,
      testUsers.standardUser.password,
    );

    const receiptId = "e2e-consistent-rejection-test";

    // Burst 1: 20 concurrent — some succeed, some may be rate-limited
    const burst1 = await browserPostConcurrent(
      page,
      "/api/receipt/download",
      { receiptId },
      20,
    );
    const rateLimited1 = burst1.filter((r) => r.status === 429);
    expect(rateLimited1.length).toBeGreaterThan(0);

    // Burst 2: 20 more — should mostly be rate-limited
    const burst2 = await browserPostConcurrent(
      page,
      "/api/receipt/download",
      { receiptId },
      20,
    );
    const rateLimited2 = burst2.filter((r) => r.status === 429);
    const successful2 = burst2.filter((r) => r.status === 200);

    expect(rateLimited2.length).toBeGreaterThanOrEqual(15);
    expect(successful2.length).toBeLessThanOrEqual(5);
  });

  test("concurrent receipt attempts do not leak across different receipt IDs", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const signinPage = new SigninPage(page);
    await signinPage.goto();
    await signinPage.signIn(
      testUsers.standardUser.email,
      testUsers.standardUser.password,
    );

    const receiptA = "e2e-isolated-receipt-a";
    const receiptB = "e2e-isolated-receipt-b";

    // Exhaust rate limit for receipt A
    await browserPostConcurrent(page, "/api/receipt/download", { receiptId: receiptA }, 6);

    // Receipt B should NOT be rate-limited (different key)
    const resB = await browserPost<{ allowed: boolean }>(page, "/api/receipt/download", { receiptId: receiptB });
    expect(resB.status).toBe(200);
    expect(resB.data.allowed).toBe(true);

    // Receipt A should still be blocked
    const resA = await browserPost(page, "/api/receipt/download", { receiptId: receiptA });
    expect(resA.status).toBe(429);
  });
});
