# BookWise - Library Management System

A modern, full-stack library management system built with Next.js 16, featuring user authentication, book catalog management, borrowing system, and comprehensive admin dashboard.

![BookWise](https://img.shields.io/badge/BookWise-v1.0.0-blue)
![Next.js](https://img.shields.io/badge/Next.js-16.0.7-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-blue)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4.0-cyan)

## 🚀 Features

### User Features

- **User Authentication** - Secure sign-up/sign-in with university ID verification
- **Book Discovery** - Browse, search, and filter books by title, author, and genre
- **Borrowing System** - Request to borrow books with due date tracking
- **Profile Management** - Update avatar, view borrowing history, manage receipts
- **Receipt Generation** - Download PDF receipts for completed transactions

### Admin Features

- **Dashboard Analytics** - Real-time statistics and activity monitoring
- **Realtime Dashboard Sync** - Redis + SSE refresh broadcasts keep all admin sessions aligned across deployed instances
- **User Management** - Approve/reject accounts, manage user roles
- **Book Catalog** - Add, edit, delete books with cover images and videos
- **Borrow Oversight** - Manage borrow requests, track returns, generate receipts

### Technical Features

- **Redis-Backed Realtime Updates** - Upstash Redis pub/sub broadcasts dashboard refresh signals and book availability updates after mutations
- **SSE Streams** - Authenticated and public Server-Sent Events deliver refresh signals over the main app origin
- **Authenticated Dashboard Snapshots** - Admin clients refetch fresh dashboard data from `/api/admin/dashboard`
- **Rate Limiting** - Redis-based rate limiting for security
- **Prefetch & Lazy-loading** - Route prefetching and dynamic component loading for faster navigation
- **Partial Table Loading** - Admin tables load with header-first skeletons for smoother UI transitions
- **Cache Invalidation** - Tagged cache revalidation for books, users, and search results
- **Email Notifications** - Automated emails for account status and reminders
- **File Uploads** - ImageKit integration for avatars and book covers
- **Workflow Automation** - Upstash QStash for scheduled tasks
- **Responsive Design** - Mobile-first design with Tailwind CSS

## 🛠 Tech Stack

### Frontend

- **Next.js 16** - React framework with App Router
- **React 19** - UI library with Server Components
- **TypeScript** - Type-safe development
- **Tailwind CSS 4** - Utility-first CSS framework
- **Radix UI** - Accessible component primitives
- **Lucide React** - Icon library

### Backend

- **Next.js API Routes** - Serverless API endpoints
- **NextAuth.js v5** - Authentication framework
- **Drizzle ORM** - Type-safe database operations
- **PostgreSQL (Neon)** - Serverless database
- **Redis (Upstash)** - Rate limiting, caching, and admin dashboard/book availability realtime pub/sub

### Infrastructure

- **Vercel** - Deployment platform
- **ImageKit** - Media storage and CDN
- **Upstash QStash** - Workflow orchestration
- **EmailJS** - Email service

## 📁 Project Structure

```
bookwise/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Authentication routes
│   ├── (root)/                   # User-facing routes
│   ├── admin/                    # Admin dashboard routes
│   ├── api/                      # API endpoints
│   └── layout.tsx                # Root layout
├── components/                   # React components
│   ├── admin/                    # Admin components
│   ├── book/                     # Book-related components
│   └── ui/                       # Reusable UI components
├── database/                     # Database configuration
│   ├── drizzle.ts               # Database client
│   ├── schema.ts                # Database schema
│   └── seed.ts                  # Database seeding
├── lib/                          # Utility libraries
│   ├── actions/                  # Server actions
│   ├── admin/                    # Admin utilities
│   ├── essentials/               # Helper functions
│   └── config.ts                 # Configuration
├── documentation/                # Project documentation
├── public/                       # Static assets
└── types.d.ts                   # TypeScript declarations
```

### Realtime SSE Setup

- The admin dashboard opens an authenticated SSE stream to `/api/admin/dashboard/realtime`.
- Clients seeking book availability data open a public stream to `/api/stream`.
- Realtime events are published through Upstash Redis pub/sub after dashboard-relevant mutations or availability changes.
- Each Node.js app instance maintains one shared Redis subscription and fans events out locally based on connected scopes (filtered correctly).
- No separate websocket port is required for deployment.

## 📚 Usage

### For Users

1. **Sign Up** - Create an account with your university ID
2. **Browse Books** - Explore the library catalog
3. **Borrow Books** - Request to borrow available books
4. **Manage Profile** - Update your avatar and view history
5. **Download Receipts** - Get PDF receipts for transactions

### For Admins

1. **Access Dashboard** - Log in with admin credentials
2. **Manage Users** - Approve accounts and manage roles
3. **Manage Books** - Add/edit books in the catalog
4. **Oversee Borrowing** - Approve requests and track returns
5. **Generate Reports** - View analytics and activity

## 📖 Documentation

Comprehensive documentation is available in the `documentation/` folder:

- **[Architecture](./documentation/Architecture.md)** - System design and patterns
- **[Database](./documentation/Database.md)** - Schema and data operations
- **[Authentication](./documentation/Authentication.md)** - User auth system
- **[Authorization](./documentation/Authorization.md)** - Role-based access control
- **[Book Catalog](./documentation/Book_Catalog.md)** - Book management system
- **[Borrowing System](./documentation/Borrowing_System.md)** - Loan management
- **[User Profile](./documentation/User_Profile.md)** - Profile management
- **[Admin Dashboard](./documentation/Admin_Dashboard.md)** - Admin interface
- **[Admin Dashboard Realtime](./documentation/Admin_Dashboard_Realtime.md)** - Redis + SSE-based admin dashboard synchronization
- **[Realtime Book Availability](./documentation/Realtime_Book_Availability.md)** - Pub/Sub mechanism supporting live book stocks
- **[Performance Improvements](./documentation/Performance_Improvements.md)** - Prefetching, lazy-loading, and route optimization
- **[Admin Dashboard Optimization](./documentation/Admin_Dashboard_Optimization.md)** - Partial table loading, skeletons, and admin search state
- **[Cache and Search Consistency](./documentation/Cache_and_Search_Consistency.md)** - Cache tags, invalidation, and search caching
- **[Receipt Generation](./documentation/Receipt_Generation.md)** - PDF receipts
- **[Email Notifications](./documentation/Email_Notifications.md)** - Notification system
- **[File Uploads](./documentation/File_Uploads.md)** - Media upload handling
- **[Rate Limiting](./documentation/Rate_Limiting.md)** - Security measures
- **[Deployment](./documentation/Deployment.md)** - Production deployment
- **[API Reference](./documentation/API_Reference.md)** - API documentation

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - The React framework
- [Vercel](https://vercel.com/) - Deployment platform
- [Neon](https://neon.tech/) - PostgreSQL hosting
- [Upstash](https://upstash.com/) - Redis and QStash
- [ImageKit](https://imagekit.io/) - Media optimization
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework

---

Built with ❤️ using Next.js and modern web technologies.
