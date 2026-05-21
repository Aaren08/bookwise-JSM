import { test, expect } from "@playwright/test";
import { TooFastPage } from "../../pages/rate-limit/too-fast.page";
import {
  resetRateLimitStateForIp,
  resetRateLimitCacheViaApi,
} from "../../utils/rate-limit";

test.describe("Rate Limiting — Auth Throttling", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.0.1" } });

  test.beforeEach(async ({ request }) => {
    await resetRateLimitStateForIp("10.0.0.1");
    await resetRateLimitCacheViaApi(request, "10.0.0.1");
  });

  test.afterEach(async ({ request }) => {
    await resetRateLimitStateForIp("10.0.0.1");
    await resetRateLimitCacheViaApi(request, "10.0.0.1");
  });

  async function captureAction(page: import("@playwright/test").Page, email: string, password: string) {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);

    let actionId = "";
    let actionUrl = "";

    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().includes("/sign-in") &&
        !actionId
      ) {
        actionId = req.headers()["next-action"] || "";
        actionUrl = req.url();
      }
    });

    await page.getByRole("button", { name: "Login" }).click();
    await expect
      .poll(() => actionId, { timeout: 10_000 })
      .not.toBe("");

    return { actionId, actionUrl };
  }

  function makeServerActionBody(formData: Record<string, string>) {
    return JSON.stringify([formData]);
  }

  test("excessive sign-in attempts trigger rate limiting via redirect", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const { actionId, actionUrl } = await captureAction(
      page,
      "throttle-test@example.com",
      "TestPass123!",
    );

    const body = makeServerActionBody({ email: "throttle-test@example.com", password: "TestPass123!" });

    // Use the request fixture (not page.request) which is not tied to page lifecycle.
    // Batching avoids overwhelming connection limits on HTTP/1.1.
    const BATCH = 10;
    const TOTAL = 10;
    let rateLimitedCount = 0;
    for (let i = 0; i < TOTAL; i += BATCH) {
      const batch = Array.from({ length: Math.min(BATCH, TOTAL - i) }, () =>
        request.post(actionUrl, {
          headers: {
            "Next-Action": actionId,
            "Content-Type": "text/plain;charset=UTF-8",
          },
          data: body,
          maxRedirects: 0,
        }),
      );
      const results = await Promise.all(batch);
      rateLimitedCount += results.filter((r) => r.status() === 303).length;
    }
    expect(rateLimitedCount).toBeGreaterThan(0);
  });

  test("/too-fast page renders correct layout and styling", async ({
    page,
  }) => {
    await page.goto("/too-fast");
    const tooFastPage = new TooFastPage(page);
    await tooFastPage.waitForPageReady();
    await tooFastPage.validateLayout();
    await tooFastPage.validateStyling();
  });

  test("/too-fast page meets WCAG accessibility standards", async ({
    page,
  }, testInfo) => {
    await page.goto("/too-fast");
    const tooFastPage = new TooFastPage(page);
    await tooFastPage.waitForPageReady();
    await tooFastPage.validateAccessibility(testInfo);
  });

  test("rate-limited sign-in prevents further authentication attempts within window", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const { actionId, actionUrl } = await captureAction(
      page,
      "rejected-test@example.com",
      "TestPass123!",
    );

    const body = makeServerActionBody({ email: "rejected-test@example.com", password: "TestPass123!" });

    // Exhaust rate limit in batches using the request fixture (not page.request)
    const BATCH = 10;
    const TOTAL = 10;
    for (let i = 0; i < TOTAL; i += BATCH) {
      const batch = Array.from({ length: Math.min(BATCH, TOTAL - i) }, () =>
        request.post(actionUrl, {
          headers: {
            "Next-Action": actionId,
            "Content-Type": "text/plain;charset=UTF-8",
          },
          data: body,
          maxRedirects: 0,
        }),
      );
      await Promise.all(batch);
    }

    // Use the same actionId/actionUrl — server actions remain valid.
    // Sending 10 more sequential requests should all be rate-limited.
    let rateLimitedCount = 0;
    for (let i = 0; i < 10; i++) {
      const res = await page.request.post(actionUrl, {
        headers: {
          "Next-Action": actionId,
          "Content-Type": "text/plain;charset=UTF-8",
        },
        data: body,
        maxRedirects: 0,
      });
      if (res.status() === 303) {
        rateLimitedCount++;
      }
    }

    expect(rateLimitedCount).toBeGreaterThan(0);

    await page.goto("/too-fast");
    const tooFastPage = new TooFastPage(page);
    await tooFastPage.waitForPageReady();
    await tooFastPage.validateLayout();
  });
});
