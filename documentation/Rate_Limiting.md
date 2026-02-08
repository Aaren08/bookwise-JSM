# Rate Limiting

## Overview

BookWise implements comprehensive rate limiting using Upstash Redis to protect against abuse, ensure fair usage, and maintain system stability. Rate limits are applied at multiple levels throughout the application.

## Technology Stack

- **Upstash Redis** - Serverless Redis for storing rate limit counters
- **@upstash/ratelimit** - Rate limiting SDK for Upstash Redis

## Configuration

### Redis Client

```typescript
// database/redis.ts
import { Redis } from "@upstash/redis";
import config from "@/lib/config";

const redis = new Redis({
  url: config.env.upstash.redisUrl,
  token: config.env.upstash.restToken,
});

export default redis;
```

### Rate Limit Definitions

```typescript
// lib/essentials/rateLimit.ts
import redis from "@/database/redis";
import { Ratelimit } from "@upstash/ratelimit";

// General authentication rate limit
export const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.fixedWindow(5, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit",
});

// Receipt download - per minute limit
export const receiptMinuteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  analytics: true,
  prefix: "ratelimit:receipt:minute",
});

// Receipt download - daily limit
export const receiptDailyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:receipt:daily",
});

// Avatar upload rate limit
export const uploadAvatarRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:uploadAvatar:daily",
});

// Avatar update rate limit
export const updateAvatarRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(5, "1 d"),
  analytics: true,
  prefix: "ratelimit:updateAvatar:daily",
});
```

## Rate Limit Types

### Fixed Window
Counts requests in fixed time intervals.

```typescript
Ratelimit.fixedWindow(5, "1 m") // 5 requests per minute
```

**Behavior:**
- Window resets at fixed intervals
- Simple and predictable
- Potential for burst at window boundaries

### Sliding Window
Smooths out request rates across time.

```typescript
Ratelimit.slidingWindow(5, "1 m") // 5 requests per minute, smoothed
```

**Behavior:**
- More accurate rate limiting
- Prevents burst at boundaries
- Slightly more resource intensive

## Rate Limits by Feature

### Authentication

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| Sign In | 5 | 1 minute | IP address |
| Sign Up | 5 | 1 minute | IP address |

**Implementation:**
```typescript
// lib/actions/auth.ts
export const signInWithCredentials = async (credentials) => {
  const ip = (await headers()).get("x-forwarded-for") || "127.0.0.1";
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return redirect("/too-fast");
  }
  // Continue with authentication
};
```

### Avatar Management

| Action | Limit | Window | Key |
|--------|-------|--------|-----|
| Upload | 10 | 1 day | User ID |
| Update | 5 | 1 day | User ID |

**Implementation:**
```typescript
// app/api/avatar/route.ts
export async function PUT(request: Request) {
  const session = await auth();
  const { success } = await uploadAvatarRateLimit.limit(session.user.id);

  if (!success) {
    return NextResponse.json({
      error: "You can only upload your avatar 10 times per day.",
    }, { status: 429 });
  }
  // Continue with upload
}
```

### Receipt Downloads

| Action | Limit | Window | Key |
|--------|-------|--------|-----|
| Download (burst) | 5 | 1 minute | User ID + Receipt ID |
| Download (daily) | 10 | 1 day | User ID + Receipt ID |

**Implementation:**
```typescript
// app/api/receipt/download/route.ts
export async function POST(req: Request) {
  const key = `receipt-download:user:${session.user.id}:receipt:${receiptId}`;

  // Check minute limit
  const minuteLimit = await receiptMinuteRateLimit.limit(key);
  if (!minuteLimit.success) {
    return NextResponse.json({
      error: "You are downloading this receipt too frequently.",
      reset: minuteLimit.reset,
    }, { status: 429 });
  }

  // Check daily limit
  const dailyLimit = await receiptDailyRateLimit.limit(key);
  if (!dailyLimit.success) {
    return NextResponse.json({
      error: "You have reached the daily download limit for this receipt.",
      reset: dailyLimit.reset,
    }, { status: 429 });
  }

  return NextResponse.json({ allowed: true });
}
```

## Rate Limit Response

### HTTP Status
Rate-limited requests return `429 Too Many Requests`.

### Response Body
```json
{
  "error": "Rate limit exceeded message",
  "reset": 1640000000000
}
```

The `reset` field contains the Unix timestamp (milliseconds) when the limit resets.

## Too Fast Page

When authentication rate limits are exceeded, users are redirected to `/too-fast`:

```typescript
// app/too-fast/page.tsx
export default function TooFast() {
  return (
    <main>
      <h1>Slow Down!</h1>
      <p>You're making too many requests. Please wait before trying again.</p>
    </main>
  );
}
```

## Rate Limit Keys

Keys are constructed to scope limits appropriately:

| Scope | Key Format | Example |
|-------|------------|---------|
| IP-based | IP address | `192.168.1.1` |
| User-based | User ID | `user:abc123` |
| Resource-specific | User ID + Resource ID | `receipt-download:user:abc123:receipt:xyz789` |

## Analytics

Rate limit analytics are enabled for all limits:

```typescript
analytics: true
```

This allows monitoring rate limit usage through the Upstash dashboard.

## Best Practices

### 1. Choose Appropriate Windows
- Short windows (minutes) for burst protection
- Long windows (days) for quota management

### 2. Use Meaningful Prefixes
```typescript
prefix: "ratelimit:feature:scope"
```

### 3. Provide Clear Error Messages
```typescript
return NextResponse.json({
  error: "You can only upload your avatar 10 times per day.",
}, { status: 429 });
```

### 4. Include Reset Time
```typescript
{
  error: "Rate limited",
  reset: result.reset
}
```

### 5. Layer Rate Limits
Combine multiple limits for better protection:
- Per-minute for burst protection
- Per-day for quota management

## Environment Variables

```env
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

## Related Files

- `database/redis.ts` - Redis client configuration
- `lib/essentials/rateLimit.ts` - Rate limit definitions
- `lib/actions/auth.ts` - Authentication rate limiting
- `app/api/avatar/route.ts` - Avatar API rate limiting
- `app/api/receipt/download/route.ts` - Receipt download rate limiting
- `app/too-fast/page.tsx` - Rate limit exceeded page
