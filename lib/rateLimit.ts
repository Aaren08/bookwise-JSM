import redis from "@/database/redis";
import { Ratelimit } from "@upstash/ratelimit";

export const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.fixedWindow(5, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit",
});

export const receiptMinuteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(2, "1 m"),
  analytics: true,
  prefix: "ratelimit:receipt:minute",
});

export const receiptDailyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:receipt:daily",
});
