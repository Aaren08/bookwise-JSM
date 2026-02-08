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
- **User Management** - Approve/reject accounts, manage user roles
- **Book Catalog** - Add, edit, delete books with cover images and videos
- **Borrow Oversight** - Manage borrow requests, track returns, generate receipts
- **Account Requests** - Review pending user registrations

### Technical Features

- **Rate Limiting** - Redis-based rate limiting for security
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
- **Redis (Upstash)** - Caching and rate limiting

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

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (Neon recommended)
- Redis instance (Upstash recommended)
- ImageKit account
- EmailJS account

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/bookwise.git
   cd bookwise
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in your environment variables:

   ```env
   DATABASE_URL=postgresql://...
   NEXTAUTH_SECRET=your-secret
   NEXTAUTH_URL=http://localhost:3000
   IMAGEKIT_PUBLIC_KEY=...
   IMAGEKIT_PRIVATE_KEY=...
   IMAGEKIT_URL_ENDPOINT=...
   UPSTASH_REDIS_REST_URL=...
   UPSTASH_REDIS_REST_TOKEN=...
   EMAILJS_SERVICE_ID=...
   EMAILJS_PUBLIC_KEY=...
   EMAILJS_PRIVATE_KEY=...
   ```

4. **Set up the database**

   ```bash
   # Generate migrations
   npm run db:generate

   # Run migrations
   npm run db:migrate

   # Seed the database
   npm run seed
   ```

5. **Start the development server**

   ```bash
   npm run dev
   ```

6. **Open your browser**
   ```
   http://localhost:3000
   ```

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
- **[Receipt Generation](./documentation/Receipt_Generation.md)** - PDF receipts
- **[Email Notifications](./documentation/Email_Notifications.md)** - Notification system
- **[File Uploads](./documentation/File_Uploads.md)** - Media upload handling
- **[Rate Limiting](./documentation/Rate_Limiting.md)** - Security measures
- **[Deployment](./documentation/Deployment.md)** - Production deployment
- **[API Reference](./documentation/API_Reference.md)** - API documentation

## 🧪 Testing

```bash
# Run linting
npm run lint

# Run tests (when implemented)
npm run test

# Run e2e tests (when implemented)
npm run test:e2e
```

## 🚀 Deployment

### Vercel (Recommended)

1. **Connect Repository** - Import to Vercel
2. **Configure Environment** - Add all required variables
3. **Deploy** - Automatic deployment on push

### Manual Deployment

```bash
# Build the application
npm run build

# Start production server
npm start
```

See [Deployment Guide](./documentation/Deployment.md) for detailed instructions.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - The React framework
- [Vercel](https://vercel.com/) - Deployment platform
- [Neon](https://neon.tech/) - PostgreSQL hosting
- [Upstash](https://upstash.com/) - Redis and QStash
- [ImageKit](https://imagekit.io/) - Media optimization
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework

## 📞 Support

For support, email engrabdalasad.com or reach out on LinkedIn platform.

---

Built with ❤️ using Next.js and modern web technologies.
