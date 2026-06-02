# Deployment

## Overview

BookWise is designed for seamless deployment to Vercel, with support for modern deployment practices including environment management, database migrations, and continuous integration. The application is optimized for serverless deployment with automatic scaling.

## Technology Stack

### Hosting Platform

- **Vercel** - Serverless deployment platform
- **Next.js** - Optimized for Vercel deployment
- **Edge Functions** - Global CDN deployment

### Database

- **Neon** - Serverless PostgreSQL
- **Drizzle Kit** - Migration management
- **Connection Pooling** - Automatic connection management

### Infrastructure

- **Upstash Redis** - Serverless Redis for caching, rate limiting, and realtime pub/sub
- **Upstash QStash** - Workflow orchestration
- **ImageKit** - Media CDN and optimization

## Environment Configuration

### Required Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@host/database

# Authentication (NextAuth v5)
AUTH_SECRET=your-nextauth-secret
AUTH_URL=https://your-domain.vercel.app

# EmailJS
EMAILJS_SERVICE_ID=your-service-id
EMAILJS_PUBLIC_KEY=your-public-key
EMAILJS_PRIVATE_KEY=your-private-key
EMAILJS_WELCOME_TEMPLATE_ID=template-id
EMAILJS_APPROVAL_TEMPLATE_ID=template-id
EMAILJS_REJECTION_TEMPLATE_ID=template-id
EMAILJS_BORROW_APPROVED_TEMPLATE_ID=template-id
EMAILJS_RETURN_REMINDER_TEMPLATE_ID=template-id

# ImageKit
IMAGEKIT_PUBLIC_KEY=your-public-key
IMAGEKIT_PRIVATE_KEY=your-private-key
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your-id

# Upstash Redis (required — used for rate limiting, caching, and realtime pub/sub)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Upstash QStash (required — used for workflow orchestration and return reminders)
UPSTASH_QSTASH_URL=https://qstash.upstash.io
UPSTASH_QSTASH_TOKEN=your-token

# Application URL (used in email templates and internal API calls)
APP_URL=https://your-domain.vercel.app
```

### Optional Environment Variables

```env
# Guards the reservation-expiry cron endpoint.
# If set, all requests to /api/book/cron/expire-reservations must include:
#   Authorization: Bearer <CRON_SECRET>
# If not set, the endpoint is unguarded — only do this in trusted environments.
CRON_SECRET=your-cron-secret
```

### Development-Only Variables

```env
# Set to "true" to bypass Upstash rate limiting during automated testing.
# This variable MUST be absent or set to "false" in production deployments.
SKIP_RATE_LIMIT=true
```

### Removed / Legacy Variables

The following variables from earlier versions of BookWise have been **removed** and must not be set. They were part of a standalone WebSocket server that has been replaced by the Redis pub/sub + SSE realtime architecture:

```env
# REMOVED — do not use
NEXT_PUBLIC_ADMIN_DASHBOARD_WS_PORT=
NEXT_PUBLIC_ADMIN_DASHBOARD_WS_URL=
ADMIN_DASHBOARD_WS_SECRET=
ADMIN_DASHBOARD_WS_ORIGINS=
```

Setting these variables has no effect but can cause confusion. Remove them from any `.env` files carried over from older deployments.

### Environment Variable Management

Vercel provides secure environment variable management:

```bash
# Set environment variables via Vercel CLI
vercel env add DATABASE_URL
vercel env add AUTH_SECRET

# Or via Vercel dashboard:
# Project Settings → Environment Variables
```

## Deployment Process

### One-Click Deployment

Deploy directly from GitHub to Vercel:

1. **Connect Repository** — Import your GitHub repository to Vercel and configure project settings.
2. **Environment Setup** — Add all required environment variables via the Vercel dashboard.
3. **Database Setup** — Create a Neon database, run initial migrations, and seed data.
4. **Deploy** — Automatic deployment triggers on push to the main branch. Pull requests receive preview deployments.

### Manual Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

## Database Setup

### Neon Database Creation

1. **Create Account** — Sign up at neon.tech
2. **Create Project** — Create a new PostgreSQL database
3. **Get Connection String** — Copy the database URL
4. **Configure Environment** — Add `DATABASE_URL` to Vercel

### Database Migrations

```bash
# Generate migration files (local development)
npm run db:generate

# Apply migrations
npm run db:migrate
```

To run migrations automatically on each production deployment, add to `package.json`:

```json
{
  "scripts": {
    "postbuild": "npm run db:migrate"
  }
}
```

### Database Seeding

```bash
# Seed the database with initial sample data
npm run seed
```

Seeding should be done manually after the first deployment, not automatically. The setup wizard (`/account` → `/setup`) handles initial system configuration and admin account creation.

## Build Configuration

### Vercel Configuration

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "app/api/**/*.ts": {
      "maxDuration": 30
    }
  }
}
```

### Build Optimization

```typescript
// next.config.ts
const nextConfig = {
  images: {
    domains: ["ik.imagekit.io"],
    formats: ["image/webp", "image/avif"],
  },
  compress: true,
  experimental: {
    serverComponentsExternalPackages: ["@upstash/workflow"],
  },
};

export default nextConfig;
```

## Performance Optimization

### Image Optimization

- **ImageKit Integration** — Automatic format conversion and resizing
- **Next.js Image Component** — Built-in `<Image>` optimization
- **Responsive Images** — Multiple breakpoints served automatically

### Caching Strategy

```typescript
// API Routes — revalidate hourly
export const revalidate = 3600;

// Static pages — revalidate daily
export const revalidate = 86400;

// On-demand invalidation after mutations
revalidatePath("/books");
revalidateTag("books");
```

### CDN Configuration

- **Vercel Edge Network** — Global CDN for all static assets
- **ImageKit CDN** — Dedicated media delivery
- **Static Asset Caching** — Long-term browser caching for hashed assets

## Monitoring and Analytics

### Vercel Analytics

```typescript
// app/layout.tsx
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

### Error Tracking

```typescript
// lib/error-tracking.ts
export const logError = (error: Error, context?: unknown) => {
  console.error("Application Error:", error, context);
};
```

### Performance Monitoring

- **Vercel Speed Insights** — Core Web Vitals tracking
- **Real User Monitoring** — Actual user performance data

## Security Configuration

### CORS Configuration

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,DELETE" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" },
        ],
      },
    ];
  },
};
```

### Security Headers

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}
```

## Realtime Infrastructure

The admin dashboard and public book availability stream use Upstash Redis pub/sub. Ensure your Upstash Redis instance supports pub/sub (available on all paid plans and the free tier with connection limits).

For high-traffic deployments, the per-instance broker architecture means Redis subscription counts scale with the number of deployed app instances, not with the number of connected admin users. Monitor Redis connection counts via the Upstash dashboard.

See [Admin Dashboard Realtime](../documentation/Admin_Dashboard_Realtime.md) for architecture details.

## Backup and Recovery

### Database Backups

Neon provides automatic backups:

- **Continuous Backups** — Point-in-time recovery to any moment
- **Branching** — Create isolated database branches for staging and testing

### Application Backups

```bash
# Export environment variables for safekeeping
vercel env pull .env.local

# Export database schema
npm run db:generate
```

## Scaling Considerations

### Serverless Scaling

- **Automatic Scaling** — Vercel handles traffic spikes automatically
- **Edge Functions** — Global distribution for latency-sensitive routes
- **Connection Pooling** — Neon's serverless driver manages database connections

### Resource Limits

```typescript
// Increase timeout for long-running API routes (max 30s on hobby plan)
export const maxDuration = 30;

// Force dynamic rendering for routes that must not be statically cached
export const dynamic = "force-dynamic";
```

## Continuous Integration

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run build
      - name: Run migrations (production only)
        if: github.ref == 'refs/heads/main'
        run: npm run db:migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

## Troubleshooting

### Common Deployment Issues

1. **Build Failures** — Check all required environment variables are set; look for TypeScript errors in build output.
2. **Runtime Errors** — Review server logs in the Vercel dashboard; verify database connectivity and Redis availability.
3. **Realtime Not Working** — Confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are correct; check that your Redis plan supports pub/sub.
4. **Cron Not Running** — If `CRON_SECRET` is set, ensure your cron caller sends `Authorization: Bearer <CRON_SECRET>` in the request header.

### Debugging Tools

```bash
# View recent deployment logs
vercel logs

# List configured environment variables
vercel env ls

# Run the app locally with production-like env
vercel dev
```

## Related Documentation

- [Vercel Deployment Guide](https://vercel.com/docs/deployments/overview)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Neon Database Docs](https://neon.tech/docs/)
- [Upstash Documentation](https://docs.upstash.com/)
- [Admin Dashboard Realtime](../documentation/Admin_Dashboard_Realtime.md)
- [Rate Limiting](../documentation/Rate_Limiting.md)
