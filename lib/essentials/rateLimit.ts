import redis from "@/database/redis";
import { Ratelimit } from "@upstash/ratelimit";

const fallbackResponse = {
  success: true,
  limit: Number.MAX_SAFE_INTEGER,
  remaining: Number.MAX_SAFE_INTEGER,
  reset: Date.now() + 60_000,
  pending: Promise.resolve(),
};

const DEFAULT_RATE_LIMIT_HEADERS = {
  "X-RateLimit-Limit": String(Number.MAX_SAFE_INTEGER),
  "X-RateLimit-Remaining": String(Number.MAX_SAFE_INTEGER),
  "X-RateLimit-Reset": String(Date.now() + 60_000),
};

const SSE_CONNECTION_TTL_MS = 90_000;

export const ANONYMOUS_SSE_CONNECTION_LIMIT = 2;
export const AUTHENTICATED_SSE_CONNECTION_LIMIT = 3;

export type RateLimitIdentity =
  | {
      key: string;
      kind: "ip";
      value: string;
    }
  | {
      key: string;
      kind: "user";
      value: string;
    };

export const safeRateLimit = async (
  rateLimitClient: Ratelimit,
  key: string,
  opts?: Parameters<Ratelimit["limit"]>[1],
) => {
  try {
    return await rateLimitClient.limit(key, opts);
  } catch (error) {
    console.warn(
      "Rate limit backend unavailable, skipping limit check:",
      error,
    );
    return fallbackResponse;
  }
};

export const getClientIp = (request: Request) => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "127.0.0.1";
  }

  return realIp?.trim() || "127.0.0.1";
};

export const getRateLimitIdentity = (
  request: Request,
  userId?: string | null,
): RateLimitIdentity => {
  if (userId) {
    return {
      key: `user:${userId}`,
      kind: "user",
      value: userId,
    };
  }

  const ip = getClientIp(request);

  return {
    key: `ip:${ip}`,
    kind: "ip",
    value: ip,
  };
};

export const createRateLimitHeaders = (
  result: Awaited<ReturnType<Ratelimit["limit"]>>,
) => ({
  "Retry-After": String(
    Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
  ),
  "X-RateLimit-Limit": String(result.limit),
  "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
  "X-RateLimit-Reset": String(result.reset),
});

export const defaultRateLimitHeaders = DEFAULT_RATE_LIMIT_HEADERS;

export const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(60, "1 m"),
  analytics: true,
  prefix: "ratelimit:api:anonymous",
});

export const authenticatedApiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(300, "1 m"),
  analytics: true,
  prefix: "ratelimit:api:authenticated",
});

export const anonymousSseConnectRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(12, "1 m"),
  analytics: true,
  prefix: "ratelimit:sse:anonymous-connect",
});

export const authenticatedSseConnectRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: true,
  prefix: "ratelimit:sse:authenticated-connect",
});

export const authEndpointRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.tokenBucket(3, "10 m", 6),
  analytics: true,
  prefix: "ratelimit:auth:token-bucket",
});

export const receiptMinuteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  analytics: true,
  prefix: "ratelimit:receipt:minute",
});

export const receiptDailyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:receipt:daily",
});

export const uploadAvatarRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:uploadAvatar:daily",
});

export const updateAvatarRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(5, "1 d"),
  analytics: true,
  prefix: "ratelimit:updateAvatar:daily",
});

export type SseConnectionLease = {
  key: string;
  limit: number;
  current: number;
  reset: number;
  success: boolean;
};

export const acquireSseConnectionLease = async (
  identity: RateLimitIdentity,
): Promise<SseConnectionLease> => {
  const connectionKey = `sse:book-stream:connections:${identity.key}`;
  const limit =
    identity.kind === "user"
      ? AUTHENTICATED_SSE_CONNECTION_LIMIT
      : ANONYMOUS_SSE_CONNECTION_LIMIT;

  try {
    const current = await redis.incr(connectionKey);
    await redis.pexpire(connectionKey, SSE_CONNECTION_TTL_MS);

    if (current > limit) {
      const remaining = await redis.decr(connectionKey);

      if (remaining <= 0) {
        await redis.del(connectionKey);
      }

      return {
        key: connectionKey,
        limit,
        current,
        reset: Date.now() + SSE_CONNECTION_TTL_MS,
        success: false,
      };
    }

    return {
      key: connectionKey,
      limit,
      current,
      reset: Date.now() + SSE_CONNECTION_TTL_MS,
      success: true,
    };
  } catch (error) {
    console.warn("Failed to acquire SSE connection lease:", error);

    return {
      key: connectionKey,
      limit,
      current: 1,
      reset: Date.now() + SSE_CONNECTION_TTL_MS,
      success: true,
    };
  }
};

export const refreshSseConnectionLease = async (leaseKey: string) => {
  try {
    await redis.pexpire(leaseKey, SSE_CONNECTION_TTL_MS);
  } catch (error) {
    console.warn("Failed to refresh SSE connection lease:", error);
  }
};

export const releaseSseConnectionLease = async (leaseKey: string) => {
  try {
    const remaining = await redis.decr(leaseKey);

    if (remaining <= 0) {
      await redis.del(leaseKey);
    }
  } catch (error) {
    console.warn("Failed to release SSE connection lease:", error);
  }
};
