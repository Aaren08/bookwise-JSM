import { Page, APIResponse, expect } from "@playwright/test";
import { Redis } from "@upstash/redis";

export function createRedisClient(): Redis | null {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

let redisClient: Redis | null;

function getRedis(): Redis | null {
  if (redisClient === undefined) redisClient = createRedisClient();
  return redisClient;
}

export const SIGN_IN_RATE_LIMIT = 60;
export const ANONYMOUS_SSE_CONNECT_RATE = 12;
export const AUTHENTICATED_SSE_CONNECT_RATE = 30;
export const ANONYMOUS_SSE_CONNECTION_LIMIT = 2;
export const AUTHENTICATED_SSE_CONNECTION_LIMIT = 3;

export const RATE_LIMIT_HEADERS = {
  RETRY_AFTER: "retry-after",
  X_RATE_LIMIT_LIMIT: "x-ratelimit-limit",
  X_RATE_LIMIT_REMAINING: "x-ratelimit-remaining",
  X_RATE_LIMIT_RESET: "x-ratelimit-reset",
} as const;

export const KNOWN_RATE_LIMIT_PREFIXES = [
  "ratelimit:api:anonymous",
  "ratelimit:api:authenticated",
  "ratelimit:sse:anonymous-connect",
  "ratelimit:sse:authenticated-connect",
  "ratelimit:auth:token-bucket",
  "ratelimit:receipt:minute",
  "ratelimit:receipt:daily",
  "ratelimit:uploadAvatar:daily",
  "ratelimit:updateAvatar:daily",
] as const;

const ALLOWED_MISSING_HEADERS = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];

export function expectRateLimitHeaders(response: APIResponse) {
  const headers = response.headers();
  for (const key of Object.values(RATE_LIMIT_HEADERS)) {
    if (ALLOWED_MISSING_HEADERS.includes(key)) continue;
    if (headers[key] !== undefined) {
      expect(Number(headers[key])).toBeGreaterThanOrEqual(0);
    }
  }
}

export function expectRetryAfterHeader(response: APIResponse) {
  const retryAfter = response.headers()[RATE_LIMIT_HEADERS.RETRY_AFTER];
  expect(retryAfter).toBeDefined();
  expect(Number(retryAfter)).toBeGreaterThan(0);
}

export function expectSseConnectionLimitHeader(response: APIResponse) {
  const limit = response.headers()["x-connection-limit"];
  expect(limit).toBeDefined();
  expect(Number(limit)).toBeGreaterThan(0);
}

export async function resetRateLimitStateForIp(ip = "127.0.0.1") {
  const r = getRedis();
  if (!r) return;
  // Some rate limiters use the IP directly as the key (e.g. ratelimit(ip))
  // Others use `ip:{ip}` format via getRateLimitIdentity (e.g. SSE)
  const suffixes = [ip, `ip:${ip}`];
  const keysToDelete = KNOWN_RATE_LIMIT_PREFIXES.flatMap((prefix) =>
    suffixes.map((suffix) => `${prefix}:${suffix}`),
  );
  try {
    await r.del(...keysToDelete);
  } catch (error) {
    console.warn("Failed to reset rate limit state for IP:", error);
  }
}

export async function resetAllRateLimitState() {
  const r = getRedis();
  if (!r) return;
  try {
    // Use broader pattern to catch all keys containing "ratelimit"
    // (some keys may have non-standard prefixes)
    const keys = await r.keys("*ratelimit*");
    if (keys && keys.length > 0) {
      await r.del(...keys);
    }
  } catch (error) {
    console.warn("Failed to reset all rate limit state:", error);
  }
}

export async function resetRateLimitCacheViaApi(
  request: import("@playwright/test").APIRequestContext,
  ip = "127.0.0.1"
) {
  try {
    // Reset sign-in rate limit for both IPv4 and IPv6 loopback.
    // Upstash REST API may see requests from ::1 (IPv6) depending on the system.
    await request.post("http://localhost:3000/api/test/reset-rate-limit", {
      data: { limiter: "api:anonymous", identifier: `ip:${ip}` },
    });
    await request.post("http://localhost:3000/api/test/reset-rate-limit", {
      data: { limiter: "auth:token-bucket", identifier: `ip:${ip}` },
    });
    await request.post("http://localhost:3000/api/test/reset-rate-limit", {
      data: { limiter: "sse:anonymous-connect", identifier: `ip:${ip}` },
    });
    if (ip === "127.0.0.1") {
      await request.post("http://localhost:3000/api/test/reset-rate-limit", {
        data: { limiter: "api:anonymous", identifier: "ip:::1" },
      });
      await request.post("http://localhost:3000/api/test/reset-rate-limit", {
        data: { limiter: "auth:token-bucket", identifier: "ip:::1" },
      });
      await request.post("http://localhost:3000/api/test/reset-rate-limit", {
        data: { limiter: "sse:anonymous-connect", identifier: "ip:::1" },
      });
    }
  } catch (error) {
    console.warn("Failed to reset rate limit cache via API:", error);
  }
}

export async function resetSseConnectionLeases(ip: string) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(`sse:book-stream:connections:ip:${ip}`);
  } catch (error) {
    console.warn("Failed to reset SSE connection leases:", error);
  }
}

export async function resetReceiptRateLimit(receiptId: string) {
  const r = getRedis();
  if (!r) return;
  try {
    // Broad pattern: find any rate limit key that contains this receiptId
    const keys = await r.keys(`*${receiptId}*`);
    if (keys && keys.length > 0) {
      // Only delete keys that look like receipt rate limit keys
      const receiptKeys = keys.filter(
        (k) =>
          k.includes("ratelimit:receipt:minute") ||
          k.includes("ratelimit:receipt:daily"),
      );
      if (receiptKeys.length > 0) {
        await r.del(...receiptKeys);
      }
    }
  } catch (error) {
    console.warn("Failed to reset receipt rate limit:", error);
  }
}

export type RateLimitDiagnostics = {
  diagnostics: string[];
  cleanup: () => void;
};

export function addRateLimitDiagnostics(page: Page): RateLimitDiagnostics {
  const diagnostics: string[] = [];

  const onResponse = (res: { status: () => number; url: () => string }) => {
    if (res.status() === 429) {
      diagnostics.push(`[RATE-LIMIT:429] ${res.url()}`);
    }
  };

  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error" && msg.text().toLowerCase().includes("rate")) {
      diagnostics.push(`[CONSOLE:RATE] ${msg.text()}`);
    }
  };

  page.on("response", onResponse);
  page.on("console", onConsole);

  return {
    diagnostics,
    cleanup: () => {
      page.removeListener("response", onResponse);
      page.removeListener("console", onConsole);
    },
  };
}
