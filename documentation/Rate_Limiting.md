# Rate Limiting

## Overview

BookWise uses Upstash Redis for distributed rate limiting so limits remain correct across local development, multiple Node.js processes, and serverless deployments such as Vercel.

The design separates three distinct concerns:

- **Request-rate limits** — sliding or fixed windows on API and auth endpoints
- **SSE connection-admission limits** — protect stream endpoints from reconnect storms
- **Concurrent SSE connection leases** — cap how many open streams a single identity can hold at once

This separation matters because an SSE handshake is not the same as a normal API request. Treating both with a small shared IP bucket caused false `429 Too Many Requests` responses during development and is unfair to legitimate traffic in production.

---

## Technology Stack

- `@upstash/redis`
- `@upstash/ratelimit`
- Next.js App Router route handlers

---

## Configuration File

All rate limit instances are defined in `lib/essentials/rateLimit.ts`.

### Development Bypass

```env
# Set to "true" to disable rate limiting in test/CI environments.
# MUST be absent or set to "false" in production.
SKIP_RATE_LIMIT=true
```

When `SKIP_RATE_LIMIT=true`, `safeRateLimit` returns `{ success: true }` without touching Redis. This is used by the E2E and integration test suites. See [Deployment](Deployment.md#development-only-variables).

---

## Resilient Fallback Behavior

If Upstash Redis is temporarily unavailable, `safeRateLimit(...)` **fails open** rather than blocking requests:

```typescript
export const safeRateLimit = async (
  limiter: Ratelimit,
  key: string,
): Promise<RateLimitResult> => {
  if (process.env.SKIP_RATE_LIMIT === "true") {
    return { success: true, limit: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER, reset: Date.now() + 60_000 };
  }

  try {
    return await limiter.limit(key);
  } catch (error) {
    console.warn("Rate limit check failed — failing open:", error);
    return { success: true, limit: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER, reset: Date.now() + 60_000 };
  }
};
```

This keeps user-facing traffic available during transient Redis failures while logging a warning on the server.

---

## Identity Model

Requests are keyed by identity rather than always using raw IPs:

```typescript
export const getRateLimitIdentity = (
  request: Request,
  userId?: string | null,
) => {
  if (userId) {
    return { key: `user:${userId}`, kind: "user", value: userId };
  }

  const ip = getClientIp(request);
  return { key: `ip:${ip}`, kind: "ip", value: ip };
};
```

- **Authenticated traffic** uses `user:<userId>` — fairer for shared networks and proxies
- **Anonymous traffic** uses `ip:<clientIp>` — extracted from `x-forwarded-for`, `x-real-ip`, or the socket address

---

## Rate Limit Configurations

### API Request Limits

```typescript
// Anonymous API traffic
export const ratelimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(60, "1 m"),
  analytics: true,
  prefix:    "ratelimit:api:anonymous",
});

// Authenticated API traffic
export const authenticatedApiRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(300, "1 m"),
  analytics: true,
  prefix:    "ratelimit:api:authenticated",
});
```

### Auth Endpoint Limits

Authentication flows use a **token bucket** to allow short legitimate bursts while throttling sustained abuse quickly:

```typescript
export const authEndpointRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.tokenBucket(3, "10 m", 6),
  analytics: true,
  prefix:    "ratelimit:auth:token-bucket",
});
```

- Refill rate: 3 tokens every 10 minutes
- Burst capacity: 6

### SSE Handshake Limits

These protect stream endpoints from reconnect storms without penalising a healthy long-lived connection:

```typescript
// Anonymous SSE connection attempts
export const anonymousSseConnectRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(12, "1 m"),
  analytics: true,
  prefix:    "ratelimit:sse:anonymous-connect",
});

// Authenticated SSE connection attempts
export const authenticatedSseConnectRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(30, "1 m"),
  analytics: true,
  prefix:    "ratelimit:sse:authenticated-connect",
});
```

These limits apply per-identity at SSE handshake time — not per message. A healthy open stream does not consume tokens after it is established.

### Feature-Specific Limits

```typescript
// Receipt downloads — minute burst guard
export const receiptMinuteRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(5, "1 m"),
  analytics: true,
  prefix:    "ratelimit:receipt:minute",
});

// Receipt downloads — daily quota
export const receiptDailyRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.fixedWindow(10, "1 d"),
  analytics: true,
  prefix:    "ratelimit:receipt:daily",
});

// Avatar ImageKit upload — daily quota
export const uploadAvatarRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.fixedWindow(10, "1 d"),
  analytics: true,
  prefix:    "ratelimit:uploadAvatar:daily",
});

// Avatar profile update (PUT /api/avatar) — daily quota
export const updateAvatarRateLimit = new Ratelimit({
  redis,
  limiter:   Ratelimit.fixedWindow(5, "1 d"),
  analytics: true,
  prefix:    "ratelimit:updateAvatar:daily",
});
```

### Endpoints Exempt from Rate Limiting

The following endpoints are not rate-limited by the application layer:

| Endpoint | Reason |
|---|---|
| `GET /api/book/cron/expire-reservations` | Guarded by `CRON_SECRET` bearer token instead |
| `GET /api/auth/imagekit` | Short-lived signed params; no meaningful abuse surface |
| Admin realtime endpoints (`/api/admin/*`) | Protected by admin session auth; admin count is small |

---

## Distributed SSE Connection Control

The old process-level listener cap has been removed. It was not valid in serverless deployments because every instance only tracked its own in-memory connections.

BookWise now uses **Redis-backed connection leases** stored in a sorted set with per-lease TTL expiry:

```typescript
export const ANONYMOUS_SSE_CONNECTION_LIMIT     = 2;
export const AUTHENTICATED_SSE_CONNECTION_LIMIT = 3;
const SSE_CONNECTION_TTL_MS = 90_000; // 90 seconds
```

### Lease Lifecycle

**On connect:**

1. Build identity key: `sse:book-stream:connections:<identity>`
2. Remove expired lease IDs from the sorted set via `ZREMRANGEBYSCORE`
3. Count active leases via `ZCARD`
4. If under limit: insert a new random `leaseId` with expiry score `now + 90s` via `ZADD`
5. Reset Redis key TTL via `PEXPIRE`
6. If at limit: reject with `429` and set `X-Connection-Limit` header

**On keepalive:**

1. Refresh the lease's expiry score via `ZADD` with `now + 90s`
2. Refresh the Redis key TTL via `PEXPIRE`

**On disconnect:**

1. Remove the specific `leaseId` via `ZREM`

Because each connection has its own unique `leaseId`, stale connections naturally age out after 90 seconds even if an instance crashes before cleanup runs.

---

## Algorithms

### Sliding Window

Used for general API requests and SSE connection-attempt limits.

**Why:** smoother than fixed windows, less boundary bursting, better fit for reconnect-heavy SSE traffic.

### Token Bucket

Used for authentication endpoints.

**Why:** allows short legitimate bursts (logging in from a new device), while throttling sustained brute-force attempts.

### Fixed Window

Used for daily quotas (avatar uploads, receipt downloads).

**Why:** acceptable for coarse daily quotas where boundary bursting is not a significant concern.

---

## Rate Limit Summary

| Category | Identity | Algorithm | Limit |
|---|---|---|---|
| API requests | Anonymous | Sliding window | 60 req/min |
| API requests | Authenticated | Sliding window | 300 req/min |
| Auth endpoints | Per identity | Token bucket | 3/10 min, burst 6 |
| SSE connect attempts | Anonymous | Sliding window | 12/min |
| SSE connect attempts | Authenticated | Sliding window | 30/min |
| Concurrent SSE streams | Anonymous | Redis lease | 2 open streams |
| Concurrent SSE streams | Authenticated | Redis lease | 3 open streams |
| Avatar upload | Per user | Fixed window | 10/day |
| Avatar profile update | Per user | Fixed window | 5/day |
| Receipt download | Per user + receipt | Sliding + fixed | 5/min, 10/day |

---

## Rate-Limit Response Headers

When a limit is exceeded the server returns `429 Too Many Requests`. The helper `createRateLimitHeaders(result)` adds standard headers:

```
Retry-After:          <seconds until reset>
X-RateLimit-Limit:    <configured limit>
X-RateLimit-Remaining:0
X-RateLimit-Reset:    <unix timestamp>
```

For SSE connection lease rejections, an additional header is included:

```
X-Connection-Limit:   <max concurrent streams for this identity>
```

Usage:

```typescript
if (!rateLimitResult.success) {
  return new Response("Too Many Requests", {
    status: 429,
    headers: createRateLimitHeaders(rateLimitResult),
  });
}
```

---

## Why the Previous Design Caused False 429s

The earlier implementation used:

- A fixed-window `5 requests / minute` limiter on the SSE handshake
- IP-only identity keys
- A process-local `100` stream cap
- Extra manual reconnect loops on the client side

That caused false positives because:

- React Strict Mode mounts/unmounts twice in development
- HMR reopens `EventSource` connections on code changes
- The browser's built-in `EventSource` already reconnects automatically
- Manual reconnect logic added extra handshakes on top
- IP-only keys are unfair for shared networks and proxies
- In-memory caps do not reflect global usage across Vercel instances

The current design fixes all of these by separating handshake admission limits from concurrent connection leases and using identity-aware keys stored in Redis.

---

## Best Practices

### 1. Use identity-aware keys

Prefer `user:<userId>` for authenticated traffic. Fall back to `ip:<ip>` only for anonymous requests.

### 2. Separate request limits from stream limits

Do not apply the same tight window to long-lived SSE connections and ordinary REST requests.

### 3. Avoid process-global counters

If a limit must be valid across instances, store it in Redis. In-memory counters are invisible to other Vercel function instances.

### 4. Always return retry metadata

Clients need `Retry-After` and `X-RateLimit-Reset` to implement graceful backoff without hammering the server.

### 5. Keep daily quotas and burst protection separate

Use short sliding windows for burst prevention and longer fixed windows for daily quotas. Combine them (as with receipt downloads) when both concerns apply.

### 6. Never set `SKIP_RATE_LIMIT=true` in production

This environment variable completely disables all rate limiting. It must only appear in `.env.local` for local development or in CI environment configs. See [Deployment](Deployment.md#development-only-variables).

---

## Related Files

- `lib/essentials/rateLimit.ts` — all rate limit instances and helpers
- `app/api/book/stream/route.ts` — SSE connection lease enforcement
- `app/api/avatar/route.ts` — avatar update rate limit
- `app/api/receipt/download/route.ts` — receipt download rate limits
- `lib/admin/realtime/useAdminDashboardRealtime.ts` — admin SSE client
- `components/book/BookOverview.tsx` — public SSE client
