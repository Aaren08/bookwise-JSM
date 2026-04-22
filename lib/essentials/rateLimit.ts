import redis from "@/database/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "node:crypto";

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
  leaseId: string | null;
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

  const leaseId = crypto.randomUUID();
  const now = Date.now();

  try {
    // Atomic: purge expired, check count, and add new lease if under limit.
    const result = (await redis.eval(
      `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local ttl_ms = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local lease_id = ARGV[4]

      redis.call('ZREMRANGEBYSCORE', key, 0, now)
      local count = redis.call('ZCARD', key)

      if count < limit then
        redis.call('ZADD', key, now + ttl_ms, lease_id)
        redis.call('PEXPIRE', key, ttl_ms)
        return {1, count + 1}
      else
        return {0, count}
      end
      `,
      [connectionKey],
      [now, SSE_CONNECTION_TTL_MS, limit, leaseId],
    )) as [number, number];

    const [successCode, current] = result;
    const success = successCode === 1;

    return {
      key: connectionKey,
      leaseId: success ? leaseId : null,
      limit,
      current,
      reset: Date.now() + SSE_CONNECTION_TTL_MS,
      success,
    };
  } catch (error) {
    console.warn("Failed to acquire SSE connection lease:", error);

    return {
      key: connectionKey,
      leaseId,
      limit,
      current: 1,
      reset: Date.now() + SSE_CONNECTION_TTL_MS,
      success: true,
    };
  }
};

export const refreshSseConnectionLease = async (
  leaseKey: string,
  leaseId: string,
) => {
  try {
    const now = Date.now();
    const expiry = now + SSE_CONNECTION_TTL_MS;
    await redis.zadd(leaseKey, { score: expiry, member: leaseId });
    await redis.pexpire(leaseKey, SSE_CONNECTION_TTL_MS);
  } catch (error) {
    console.warn("Failed to refresh SSE connection lease:", error);
  }
};

export const releaseSseConnectionLease = async (
  leaseKey: string,
  leaseId: string,
) => {
  try {
    await redis.zrem(leaseKey, leaseId);
  } catch (error) {
    console.warn("Failed to release SSE connection lease:", error);
  }
};
