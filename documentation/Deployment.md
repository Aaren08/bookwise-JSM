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

- **Upstash Redis** - Serverless Redis for caching and rate limiting
- **Upstash QStash** - Workflow orchestration
- **ImageKit** - Media CDN and optimization

## Environment Configuration

### Required Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@host/database

# Authentication
NEXTAUTH_SECRET=your-nextauth-secret
NEXTAUTH_URL=https://your-domain.vercel.app

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

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Upstash QStash
UPSTASH_QSTASH_URL=https://qstash.upstash.io
UPSTASH_QSTASH_TOKEN=your-token

# Application
APP_URL=https://your-domain.vercel.app
```

### Environment Variable Management

Vercel provides secure environment variable management:

```bash
# Set environment variables via Vercel CLI
vercel env add DATABASE_URL
vercel env add NEXTAUTH_SECRET

# Or via Vercel dashboard
# Project Settings → Environment Variables
```

## Deployment Process

### One-Click Deployment

Deploy directly from GitHub to Vercel:

1. **Connect Repository**
   - Import GitHub repository to Vercel
   - Configure project settings

2. **Environment Setup**
   - Add all required environment variables
   - Configure build settings

3. **Database Setup**
   - Create Neon database
   - Run initial migrations
   - Seed database

4. **Deploy**
   - Automatic deployment on push to main branch
   - Preview deployments for pull requests

### Manual Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy project
vercel

# Set production domain
vercel --prod
```

## Database Setup

### Neon Database Creation

1. **Create Account** - Sign up at neon.tech
2. **Create Project** - New PostgreSQL database
3. **Get Connection String** - Copy database URL
4. **Configure Environment** - Add DATABASE_URL to Vercel

### Database Migrations

```bash
# Generate migrations (local development)
npm run db:generate

# Run migrations on deployment
npm run db:migrate

# For production deployment, add to build script
# package.json
{
  "scripts": {
    "postbuild": "npm run db:migrate"
  }
}
```

### Database Seeding

```bash
# Seed database with initial data
npm run seed
```

**Note**: Seeding should be done manually after first deployment, not automatically.

## Build Configuration

### Vercel Configuration

```json
// vercel.json
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
  // Image optimization
  images: {
    domains: ["ik.imagekit.io"],
    formats: ["image/webp", "image/avif"],
  },

  // Compression
  compress: true,

  // Experimental features
  experimental: {
    serverComponentsExternalPackages: ["@upstash/workflow"],
  },
};

export default nextConfig;
```

## Performance Optimization

### Image Optimization

- **ImageKit Integration** - Automatic image optimization
- **Next.js Image Component** - Built-in optimization
- **Responsive Images** - Multiple breakpoints

### Caching Strategy

```typescript
// API Routes - Cache control
export const revalidate = 3600; // 1 hour

// Static pages - ISR
export const revalidate = 86400; // 24 hours

// Dynamic data - On-demand revalidation
revalidatePath("/books");
revalidateTag("books");
```

### CDN Configuration

- **Vercel Edge Network** - Global CDN
- **ImageKit CDN** - Media delivery
- **Static Asset Caching** - Long-term caching for assets

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
export const logError = (error: Error, context?: any) => {
  // Log to Vercel logs
  console.error("Application Error:", error, context);

  // Send to error tracking service (future)
  // sendToErrorTracker(error, context);
};
```

### Performance Monitoring

- **Vercel Speed Insights** - Performance metrics
- **Core Web Vitals** - User experience metrics
- **Real User Monitoring** - Actual user performance

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
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE" },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type,Authorization",
          },
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

  // Security headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}
```

## Backup and Recovery

### Database Backups

Neon provides automatic backups:

- **Daily Backups** - Automatic daily snapshots
- **Point-in-Time Recovery** - Restore to any point
- **Branching** - Create database branches for testing

### Application Backups

```bash
# Backup environment variables
vercel env pull .env.local

# Backup database schema
npm run db:generate

# Backup static assets (if any)
# Assets are stored in ImageKit, backed up automatically
```

## Scaling Considerations

### Serverless Scaling

- **Automatic Scaling** - Vercel handles traffic spikes
- **Edge Functions** - Global distribution
- **Connection Pooling** - Neon handles database connections

### Resource Limits

```typescript
// API Route limits
export const maxDuration = 30; // 30 seconds for API routes
export const dynamic = "force-dynamic"; // Disable static generation for dynamic routes
```

### Cost Optimization

- **Function Optimization** - Minimize function execution time
- **Caching** - Reduce database queries
- **Image Optimization** - Reduce bandwidth usage

## Continuous Integration

### GitHub Integration

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
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - run: npm ci
      - run: npm run build
      - run: npm run db:migrate
        if: github.ref == 'refs/heads/main'
```

### Automated Testing

```yaml
# Add to CI pipeline
- run: npm run lint
- run: npm run test
- run: npm run test:e2e
```

## Troubleshooting

### Common Deployment Issues

1. **Build Failures**
   - Check environment variables
   - Verify database connectivity
   - Check for TypeScript errors

2. **Runtime Errors**
   - Check server logs in Vercel dashboard
   - Verify API endpoints
   - Check database connection

3. **Performance Issues**
   - Monitor function duration
   - Check database query performance
   - Optimize images and assets

### Debugging Tools

```bash
# View deployment logs
vercel logs

# Check environment variables
vercel env ls

# Test functions locally
vercel dev
```

## Maintenance Tasks

### Regular Maintenance

- **Update Dependencies** - Keep packages updated
- **Monitor Performance** - Track Core Web Vitals
- **Database Optimization** - Monitor query performance
- **Security Updates** - Apply security patches

### Automated Tasks

```typescript
// Scheduled functions for maintenance
export const revalidate = 86400; // Daily revalidation

// Clean up old data
export async function cleanupOldData() {
  // Remove old borrow records
  // Clean up temporary files
  // Update statistics
}
```

## Future Enhancements

### Planned Improvements

- **Multi-region Deployment** - Global edge deployment
- **Blue-Green Deployments** - Zero-downtime updates
- **Automated Rollbacks** - Quick recovery from issues
- **Advanced Monitoring** - Detailed performance insights
- **Disaster Recovery** - Automated backup restoration

## Related Documentation

- [Vercel Deployment Guide](https://vercel.com/docs/deployments/overview)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Neon Database Docs](https://neon.tech/docs/)
- [Upstash Documentation](https://docs.upstash.com/)</content>
  <parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\Deployment.md
