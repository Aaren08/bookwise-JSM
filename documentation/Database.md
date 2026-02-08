# Database

## Overview

BookWise uses PostgreSQL as its database, hosted on Neon (serverless Postgres), with Drizzle ORM for type-safe database operations.

## Technology Stack

- **Database**: PostgreSQL (Neon Serverless)
- **ORM**: Drizzle ORM
- **Driver**: `@neondatabase/serverless`
- **Migrations**: Drizzle Kit

## Configuration

### Database Connection

```typescript
// database/drizzle.ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import config from "@/lib/config";

const sql = neon(config.env.databaseUrl);
export const db = drizzle({ client: sql });
```

### Drizzle Configuration

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./database/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

## Schema

### Enums

```typescript
// Status for user account approval
export const STATUS_ENUM = pgEnum("status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

// User roles
export const ROLE_ENUM = pgEnum("role", ["USER", "ADMIN"]);

// Borrow record status
export const BORROW_STATUS_ENUM = pgEnum("borrow_status", [
  "PENDING",
  "BORROWED",
  "RETURNED",
  "LATE_RETURN",
]);
```

### Users Table

```typescript
export const users = pgTable("users", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  userAvatar: text("user_avatar"),
  userAvatarFileId: text("user_avatar_file_id"),
  email: varchar("email", { length: 255 }).notNull().unique(),
  universityId: varchar("university_id", { length: 30 }).notNull().unique(),
  password: text("password").notNull(),
  universityCard: text("university_card").notNull(),
  status: STATUS_ENUM("status").default("PENDING"),
  role: ROLE_ENUM("role").default("USER"),
  lastActivityDate: date("last_activity_date").defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

**Fields:**
- `id` - UUID primary key, auto-generated
- `fullName` - User's full name
- `userAvatar` - URL to profile image
- `userAvatarFileId` - ImageKit file ID for deletion
- `email` - Unique email address
- `universityId` - Unique university ID number
- `password` - Bcrypt hashed password
- `universityCard` - URL to university card image
- `status` - Account approval status
- `role` - USER or ADMIN
- `lastActivityDate` - For activity tracking
- `createdAt` - Account creation timestamp

### Books Table

```typescript
export const books = pgTable("books", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  author: varchar("author", { length: 255 }).notNull(),
  genre: varchar("genre", { length: 255 }).notNull(),
  rating: real("rating").notNull().default(0),
  totalCopies: integer("total_copies").notNull().default(1),
  availableCopies: integer("available_copies").notNull().default(0),
  description: text("description").notNull(),
  coverColor: varchar("cover_color", { length: 7 }).notNull(),
  coverUrl: text("cover_url").notNull(),
  videoUrl: text("video_url").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

**Fields:**
- `id` - UUID primary key
- `title` - Book title
- `author` - Author name
- `genre` - Book genre/category
- `rating` - Average rating (0-5)
- `totalCopies` - Total copies in library
- `availableCopies` - Currently available copies
- `description` - Short description
- `coverColor` - Hex color for card background
- `coverUrl` - Book cover image URL
- `videoUrl` - Book trailer/intro video URL
- `summary` - Detailed book summary
- `createdAt` - When book was added

### Borrow Records Table

```typescript
export const borrowRecords = pgTable("borrow_records", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  bookId: uuid("book_id")
    .references(() => books.id)
    .notNull(),
  borrowDate: timestamp("borrow_date", { withTimezone: true })
    .defaultNow()
    .notNull(),
  dueDate: date("due_date").notNull(),
  returnDate: date("return_date"),
  borrowStatus: BORROW_STATUS_ENUM("borrow_status")
    .default("PENDING")
    .notNull(),
  dismissed: integer("dismissed").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

**Fields:**
- `id` - UUID primary key
- `userId` - Foreign key to users table
- `bookId` - Foreign key to books table
- `borrowDate` - When book was borrowed
- `dueDate` - When book should be returned
- `returnDate` - When book was actually returned
- `borrowStatus` - Current status of the borrow
- `dismissed` - Whether user dismissed the record (1) or not (0)
- `createdAt` - Record creation timestamp

## Relationships

```
users (1) ←──── (N) borrowRecords (N) ────→ (1) books
```

- A user can have many borrow records
- A book can have many borrow records
- Each borrow record belongs to one user and one book

## Common Operations

### Insert

```typescript
// Insert a new user
await db.insert(users).values({
  fullName,
  email,
  universityId,
  password: hashedPassword,
  universityCard,
});

// Insert a new book
const newBook = await db
  .insert(books)
  .values({
    ...params,
    availableCopies: params.totalCopies,
  })
  .returning();
```

### Select

```typescript
// Select user by email
const user = await db
  .select()
  .from(users)
  .where(eq(users.email, email))
  .limit(1);

// Select with join
const records = await db
  .select({
    id: borrowRecords.id,
    bookTitle: books.title,
    userFullName: users.fullName,
  })
  .from(borrowRecords)
  .innerJoin(books, eq(borrowRecords.bookId, books.id))
  .innerJoin(users, eq(borrowRecords.userId, users.id));
```

### Update

```typescript
// Update user status
await db
  .update(users)
  .set({ status: "APPROVED" })
  .where(eq(users.id, userId));

// Atomic update with SQL expression
await db
  .update(books)
  .set({
    availableCopies: sql`${books.availableCopies} + 1`,
  })
  .where(eq(books.id, bookId));
```

### Delete

```typescript
// Delete a book
const deletedBook = await db
  .delete(books)
  .where(eq(books.id, id))
  .returning();

// Delete with condition
await db
  .delete(borrowRecords)
  .where(inArray(borrowRecords.borrowStatus, ["RETURNED", "LATE_RETURN"]));
```

### Count

```typescript
// Count total books
const [{ value: totalBooks }] = await db
  .select({ value: count() })
  .from(books);

// Count with condition
const [{ value: borrowedBooks }] = await db
  .select({ value: count() })
  .from(borrowRecords)
  .where(eq(borrowRecords.borrowStatus, "BORROWED"));
```

### Search

```typescript
// Case-insensitive search
const results = await db
  .select()
  .from(books)
  .where(
    or(
      ilike(books.title, `%${query}%`),
      ilike(books.author, `%${query}%`),
      ilike(books.genre, `%${query}%`)
    )
  );
```

## Migrations

### Commands

```bash
# Generate migration files
npm run db:generate

# Run migrations
npm run db:migrate

# Open Drizzle Studio
npm run db:studio
```

### Seeding

```bash
# Seed the database
npm run seed
```

The seed script (`database/seed.ts`) populates the database with initial data.

## Performance Considerations

### Indexing
- Primary keys (id) are automatically indexed
- Unique constraints (email, universityId) create indexes
- Consider adding indexes for frequently queried fields

### Connection Pooling
- Neon's serverless driver handles connection pooling automatically
- Connections are established per-request and released after

### Query Optimization
- Use `limit()` for pagination
- Use `select()` with specific fields instead of `select()`
- Use parallel queries with `Promise.all()` when possible

## Related Files

- `database/schema.ts` - Schema definitions
- `database/drizzle.ts` - Database client
- `database/seed.ts` - Seed script
- `drizzle.config.ts` - Drizzle configuration
- `migrations/` - Migration files
