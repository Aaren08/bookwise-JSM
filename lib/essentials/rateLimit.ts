import redis from "@/database/redis";
import { Ratelimit } from "@upstash/ratelimit";

const fallbackResponse = {
  success: true,
  limit: Number.MAX_SAFE_INTEGER,
  remaining: Number.MAX_SAFE_INTEGER,
  reset: Date.now() + 60_000,
  pending: Promise.resolve(),
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

export const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.fixedWindow(5, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit",
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
