# Rate Limiting

## Overview

BookWise uses Upstash Redis for distributed rate limiting so limits remain correct across local dev, multiple Node processes, and serverless deployments such as Vercel.

The current design separates:

- request-rate limits
- SSE connection-admission limits
- concurrent SSE connection leases

This is important because an SSE handshake is not the same thing as a normal API request. Treating both with the same tiny IP bucket caused false `429 Too Many Requests` responses during development and would be unfair in production.

## Goals

- Prevent abusive bursts without throttling normal page loads and SSE reconnects
- Differentiate anonymous traffic from authenticated traffic
- Keep limits valid across distributed/serverless instances
- Return useful rate-limit metadata to clients

## Technology Stack

- `@upstash/redis`
- `@upstash/ratelimit`
- Next.js App Router route handlers

## Current Configuration

The active configuration lives in `lib/essentials/rateLimit.ts`.

### Resilient Fallback Behavior

If Upstash Redis is temporarily unavailable, `safeRateLimit(...)` fails open instead of blocking requests:

- `success: true`
- effectively unbounded `limit` and `remaining`
- a synthetic `reset` about `60s` in the future

This keeps user-facing traffic available during transient rate-limit backend failures while logging a warning on the server.

### Identity Model

Requests are keyed by identity instead of always using IPs:

- authenticated traffic: `user:<userId>`
- anonymous traffic: `ip:<clientIp>`

Helper:

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

### API Request Limits

```typescript
export const ratelimit = new Ratelimit({
  redis,
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
```

### SSE Handshake Limits

These protect the stream endpoint from reconnect storms without treating a healthy long-lived stream like repeated API spam.

```typescript
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
```

### Auth Endpoint Limits

Authentication flows are better protected by a token bucket so small bursts are allowed but sustained abuse is throttled quickly.

```typescript
export const authEndpointRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.tokenBucket(3, "10 m", 6),
  analytics: true,
  prefix: "ratelimit:auth:token-bucket",
});
```

Meaning:

- refill rate: `3` tokens every `10 minutes`
- burst size: `6`

### Feature-Specific Limits

These older route-specific limits still exist and are separate from the new SSE work:

```typescript
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
```

## Distributed SSE Connection Control

The old process-level listener cap was removed. It was not valid in serverless because every instance only knew about its own memory.

BookWise now uses Redis-backed connection leases stored in a sorted set with per-lease expiry:

```typescript
const SSE_CONNECTION_TTL_MS = 90_000;

export const ANONYMOUS_SSE_CONNECTION_LIMIT = 2;
export const AUTHENTICATED_SSE_CONNECTION_LIMIT = 3;
```

On connect:

1. Build a key: `sse:book-stream:connections:<identity>`
2. Remove expired lease ids with `ZREMRANGEBYSCORE`
3. Count active leases with `ZCARD`
4. Insert a new random lease id with expiry score `now + 90s` when under limit
5. Apply `PEXPIRE` to the sorted-set key
6. Reject the connection when the active lease count is already at the limit

On keepalive:

1. Refresh that lease id with a new expiry score via `ZADD`
2. Refresh the Redis key TTL with `PEXPIRE`

On disconnect:

1. Remove the lease id with `ZREM`

Because each connection has its own lease id, stale connections naturally age out after `90s` even if an instance crashes before cleanup runs.

## Algorithms Used

### Sliding Window

Used for general API requests and SSE connection attempts.

Why:

- smoother than fixed windows
- less boundary bursting
- better fit for reconnect-heavy traffic

### Token Bucket

Used for auth endpoints.

Why:

- allows short legitimate bursts
- throttles sustained abuse
- works well for login/signup/reset flows

### Fixed Window

Still acceptable for coarse daily quotas such as avatars and receipt downloads.

## Recommended Thresholds

These are the practical thresholds currently represented by the code or intended by the architecture:

| Category | Identity | Limit |
|----------|----------|-------|
| API requests | Anonymous | `60/min` |
| API requests | Authenticated | `300/min` |
| SSE connect attempts | Anonymous | `12/min` |
| SSE connect attempts | Authenticated | `30/min` |
| Open SSE streams | Anonymous | `2` |
| Open SSE streams | Authenticated | `3` |
| Auth endpoints | Per identity | token bucket `3/10 min`, burst `6` |

## Rate-Limit Responses

When a rate limit trips, the server returns `429 Too Many Requests`.

The helper `createRateLimitHeaders(...)` adds:

```text
Retry-After
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

Example:

```typescript
if (!rateLimitResult.success) {
  return new Response("Too Many Requests", {
    status: 429,
    headers: createRateLimitHeaders(rateLimitResult),
  });
}
```

SSE connection leases may also return:

```text
X-Connection-Limit
```

when the client already has too many open streams.

If the lease check fails because Redis is unavailable, the lease helper also fails open and allows the connection while logging a warning. In that fallback path it returns a synthetic successful lease with `current: 1`.

## Why The Previous Design Caused 429s

The earlier implementation used:

- a fixed-window `5 requests / minute` limiter
- an IP-only key
- a process-local `100` stream cap
- extra manual reconnect loops on the client

That caused false positives because:

- React Strict Mode can mount/unmount twice in dev
- HMR can reopen EventSource connections repeatedly
- browser SSE already reconnects automatically
- manual reconnect logic adds even more handshakes
- IP-only keys are unfair for shared networks and proxies
- in-memory caps do not reflect global usage on Vercel

## Best Practices

### 1. Use identity-aware keys

Prefer user-based limits for authenticated traffic and IP-based limits only for anonymous traffic.

### 2. Separate request limits from stream limits

Do not treat long-lived SSE connections like ordinary REST requests.

### 3. Avoid process-global counters

If a limit must be valid across instances, store it in Redis.

### 4. Return retry metadata

Clients need `Retry-After` and reset information for graceful backoff.

### 5. Keep daily quotas and burst protection separate

Use short windows for bursts and longer windows for quotas.

## Related Files

- `lib/essentials/rateLimit.ts`
- `app/api/book/stream/route.ts`
- `components/book/BookOverview.tsx`
- `lib/admin/realtime/useAdminDashboardRealtime.ts`
- `app/api/receipt/download/route.ts`
- `app/api/avatar/route.ts`
