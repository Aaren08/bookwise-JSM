import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getClientIp,
  getRateLimitIdentity,
  createRateLimitHeaders,
  safeRateLimit,
  ANONYMOUS_SSE_CONNECTION_LIMIT,
  AUTHENTICATED_SSE_CONNECTION_LIMIT,
} from "@/lib/essentials/rateLimit";

const mockRequest = (headers: Record<string, string>): Request =>
  new Request("http://localhost", { headers });

describe("getClientIp", () => {
  describe("x-forwarded-for header", () => {
    it("returns single IP from x-forwarded-for", () => {
      const req = mockRequest({ "x-forwarded-for": "203.0.113.42" });
      expect(getClientIp(req)).toBe("203.0.113.42");
    });

    it("returns first IP when multiple comma-separated IPs are present", () => {
      const req = mockRequest({
        "x-forwarded-for": "203.0.113.42, 198.51.100.7, 192.0.2.1",
      });
      expect(getClientIp(req)).toBe("203.0.113.42");
    });

    it("trims whitespace from the first IP", () => {
      const req = mockRequest({
        "x-forwarded-for": "  203.0.113.42  , 198.51.100.7",
      });
      expect(getClientIp(req)).toBe("203.0.113.42");
    });

    it("falls back to 127.0.0.1 if x-forwarded-for has empty first entry", () => {
      const req = mockRequest({ "x-forwarded-for": ", 198.51.100.7" });
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("prefers x-forwarded-for over x-real-ip when both present", () => {
      const req = mockRequest({
        "x-forwarded-for": "203.0.113.42",
        "x-real-ip": "10.0.0.1",
      });
      expect(getClientIp(req)).toBe("203.0.113.42");
    });
  });

  describe("x-real-ip header", () => {
    it("returns IP from x-real-ip when x-forwarded-for is absent", () => {
      const req = mockRequest({ "x-real-ip": "10.0.0.5" });
      expect(getClientIp(req)).toBe("10.0.0.5");
    });

    it("trims whitespace from x-real-ip", () => {
      const req = mockRequest({ "x-real-ip": "  10.0.0.5  " });
      expect(getClientIp(req)).toBe("10.0.0.5");
    });
  });

  describe("fallback behavior", () => {
    it("returns 127.0.0.1 when no proxy headers exist", () => {
      const req = mockRequest({});
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("returns 127.0.0.1 when headers are empty strings", () => {
      const req = mockRequest({
        "x-forwarded-for": "",
        "x-real-ip": "",
      });
      expect(getClientIp(req)).toBe("127.0.0.1");
    });
  });

  describe("IPv6 handling", () => {
    it("returns IPv6 address from x-forwarded-for", () => {
      const req = mockRequest({
        "x-forwarded-for": "2001:db8::1",
      });
      expect(getClientIp(req)).toBe("2001:db8::1");
    });

    it("returns IPv6 from x-real-ip", () => {
      const req = mockRequest({ "x-real-ip": "::1" });
      expect(getClientIp(req)).toBe("::1");
    });
  });
});

describe("getRateLimitIdentity", () => {
  it("returns user identity when userId is provided", () => {
    const req = mockRequest({});
    const result = getRateLimitIdentity(req, "user-123");

    expect(result).toEqual({
      key: "user:user-123",
      kind: "user",
      value: "user-123",
    });
  });

  it("returns IP identity when userId is null", () => {
    const req = mockRequest({ "x-forwarded-for": "203.0.113.42" });
    const result = getRateLimitIdentity(req, null);

    expect(result).toEqual({
      key: "ip:203.0.113.42",
      kind: "ip",
      value: "203.0.113.42",
    });
  });

  it("returns IP identity when userId is undefined", () => {
    const req = mockRequest({ "x-forwarded-for": "198.51.100.7" });
    const result = getRateLimitIdentity(req);

    expect(result).toEqual({
      key: "ip:198.51.100.7",
      kind: "ip",
      value: "198.51.100.7",
    });
  });

  it("returns IP identity when userId is empty string", () => {
    const req = mockRequest({ "x-real-ip": "10.0.0.1" });
    const result = getRateLimitIdentity(req, "");

    expect(result).toEqual({
      key: "ip:10.0.0.1",
      kind: "ip",
      value: "10.0.0.1",
    });
  });

  it("uses 127.0.0.1 for anonymous request without proxy headers", () => {
    const req = mockRequest({});
    const result = getRateLimitIdentity(req, null);

    expect(result).toEqual({
      key: "ip:127.0.0.1",
      kind: "ip",
      value: "127.0.0.1",
    });
  });

  it("preserves IPv6 address in identity", () => {
    const req = mockRequest({ "x-forwarded-for": "2001:db8::1" });
    const result = getRateLimitIdentity(req, null);

    expect(result.kind).toBe("ip");
    expect(result.value).toBe("2001:db8::1");
    expect(result.key).toBe("ip:2001:db8::1");
  });
});

describe("createRateLimitHeaders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
  });

  const baseResult = {
    success: true,
    limit: 60,
    remaining: 55,
    reset: Date.now() + 60_000,
    pending: Promise.resolve(),
  };

  it("returns Retry-After based on reset minus now", () => {
    const now = Date.now();
    const result = createRateLimitHeaders({
      ...baseResult,
      reset: now + 30_000,
    });

    expect(result["Retry-After"]).toBe("30");
  });

  it("returns Retry-After of at least 1 second", () => {
    const now = Date.now();
    const result = createRateLimitHeaders({
      ...baseResult,
      reset: now + 500,
    });

    expect(result["Retry-After"]).toBe("1");
  });

  it("returns Retry-After of 0 when reset is in the past", () => {
    const now = Date.now();
    const result = createRateLimitHeaders({
      ...baseResult,
      reset: now - 5000,
    });

    expect(result["Retry-After"]).toBe("1");
  });

  it("returns X-RateLimit-Limit from result.limit", () => {
    const result = createRateLimitHeaders(baseResult);

    expect(result["X-RateLimit-Limit"]).toBe("60");
  });

  it("returns X-RateLimit-Remaining as max(0, result.remaining)", () => {
    const result = createRateLimitHeaders({ ...baseResult, remaining: 15 });

    expect(result["X-RateLimit-Remaining"]).toBe("15");
  });

  it("returns 0 for remaining when negative", () => {
    const result = createRateLimitHeaders({ ...baseResult, remaining: -5 });

    expect(result["X-RateLimit-Remaining"]).toBe("0");
  });

  it("returns X-RateLimit-Reset from result.reset", () => {
    const result = createRateLimitHeaders(baseResult);

    expect(result["X-RateLimit-Reset"]).toBe(String(baseResult.reset));
  });

  it("handles maximum safe integer limit", () => {
    const result = createRateLimitHeaders({
      ...baseResult,
      limit: Number.MAX_SAFE_INTEGER,
    });

    expect(result["X-RateLimit-Limit"]).toBe(String(Number.MAX_SAFE_INTEGER));
  });
});

describe("safeRateLimit", () => {
  beforeEach(() => {
    vi.stubEnv("SKIP_RATE_LIMIT", "false");
  });

  const mockSuccess = {
    success: true,
    limit: 60,
    remaining: 55,
    reset: Date.now() + 60_000,
    pending: Promise.resolve(),
  };

  it("returns fallback when SKIP_RATE_LIMIT is true", async () => {
    vi.stubEnv("SKIP_RATE_LIMIT", "true");

    const result = await safeRateLimit(
      { limit: vi.fn() } as never,
      "some-key",
    );

    expect(result.success).toBe(true);
    expect(result.limit).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns the rate limit client result on success", async () => {
    const mockClient = {
      limit: vi.fn().mockResolvedValue(mockSuccess),
    };

    const result = await safeRateLimit(
      mockClient as never,
      "test-key",
      undefined,
    );

    expect(result).toEqual(mockSuccess);
    expect(mockClient.limit).toHaveBeenCalledWith("test-key", undefined);
  });

  it("passes opts to rateLimitClient.limit", async () => {
    const opts = { resources: 5 };
    const mockClient = {
      limit: vi.fn().mockResolvedValue(mockSuccess),
    };

    await safeRateLimit(mockClient as never, "test-key", opts);

    expect(mockClient.limit).toHaveBeenCalledWith("test-key", opts);
  });

  it("returns fallback when rate limit client throws", async () => {
    const mockClient = {
      limit: vi.fn().mockRejectedValue(new Error("Redis unreachable")),
    };

    const result = await safeRateLimit(
      mockClient as never,
      "test-key",
    );

    expect(result.success).toBe(true);
    expect(result.limit).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns fallback when rate limit client throws non-Error", async () => {
    const mockClient = {
      limit: vi.fn().mockRejectedValue("string error"),
    };

    const result = await safeRateLimit(
      mockClient as never,
      "test-key",
    );

    expect(result.success).toBe(true);
  });
});

describe("SSE connection limit constants", () => {
  it("defines ANONYMOUS_SSE_CONNECTION_LIMIT as 2", () => {
    expect(ANONYMOUS_SSE_CONNECTION_LIMIT).toBe(2);
  });

  it("defines AUTHENTICATED_SSE_CONNECTION_LIMIT as 3", () => {
    expect(AUTHENTICATED_SSE_CONNECTION_LIMIT).toBe(3);
  });
});
