# Book Catalog

## Overview

BookWise features a comprehensive book catalog system that allows users to browse, search, and discover books in the library. The system supports rich metadata, ratings, availability tracking, and multimedia content including book covers and promotional videos.

## Book Data Model

### Core Fields

```typescript
interface Book {
  id: string;           // UUID primary key
  title: string;        // Book title (max 255 chars)
  author: string;       // Author name (max 255 chars)
  genre: string;        // Book category/genre (max 255 chars)
  rating: number;       // Average rating (0–5 scale)
  totalCopies: number;  // Total physical copies owned
  borrowedCount: number;  // Active approved loans
  reservedCount: number;  // Pending borrow requests holding a copy
  availableCopies: number; // Generated: totalCopies - borrowedCount - reservedCount
  description: string;  // Short description/synopsis
  coverColor: string;   // Hex color for card background
  coverUrl: string;     // Book cover image URL
  videoUrl: string;     // Promotional video/trailer URL
  summary: string;      // Detailed book summary
  createdAt: Date;      // Creation timestamp
}
```

### Availability Model

`availableCopies` is a **generated database column** — it is never written directly by application code. Its value is always computed by PostgreSQL as:

```
availableCopies = totalCopies - borrowedCount - reservedCount
```

- `borrowedCount` — incremented when a pending request is approved; decremented when a book is returned.
- `reservedCount` — incremented when a user creates a new borrow request; decremented when the request is approved, rejected, or expires.

This design ensures inventory consistency under concurrent requests. See [Borrowing System](Borrowing_System.md) for the full lifecycle.

## Book Display Components

### BookCard Component

The primary component for displaying books in grid/list layouts:

```tsx
<BookCard
  id={book.id}
  title={book.title}
  genre={book.genre}
  coverColor={book.coverColor}
  coverUrl={book.coverUrl}
>
  {/* Optional children for additional content */}
</BookCard>
```

**Features:**

- Responsive design with hover effects
- Custom cover colors and images
- Genre categorization
- Link to detailed book page

### BookCover Component

Handles book cover display with fallback to a colored SVG:

```tsx
<BookCover
  coverColor="#1e40af"
  coverImage="/covers/book.jpg"
/>
```

### BookOverview Component

Detailed book information display with borrowing functionality:

```tsx
<BookOverview book={bookData} userId={currentUser.id} />
```

**Includes:**

- Full book metadata
- Real-time availability status (via `/api/book/stream`)
- Borrow request button
- Rating display
- Video trailer (if available)

## Book Search and Filtering

### Search Functionality

Users can search books by title, author, or genre (case-insensitive):

```typescript
const results = await db
  .select()
  .from(books)
  .where(
    or(
      ilike(books.title, `%${query}%`),
      ilike(books.author, `%${query}%`),
      ilike(books.genre, `%${query}%`),
    ),
  );
```

Search results are served through the `searchBooksCached` helper defined in `lib/performance/cache.ts`, which caches responses and revalidates on book mutations.

### SearchFilter Component

Advanced filtering options:

- Genre selection
- Availability status
- Sort by title, author, rating, or date added

## Book Management (Admin Only)

### Creating Books

Admins add new books through the admin dashboard. Required fields:

```typescript
const newBookData = {
  title: "Book Title",
  author: "Author Name",
  genre: "Fiction",
  totalCopies: 5,
  description: "Book description...",
  coverColor: "#3b82f6",
  coverUrl: "https://example.com/cover.jpg",
  videoUrl: "https://example.com/trailer.mp4",
  summary: "Detailed summary...",
};
```

`borrowedCount` and `reservedCount` default to `0` on creation. `availableCopies` is automatically computed.

### Updating Books

Admins can modify book metadata, cover images, and total copy counts. Reducing `totalCopies` below the current `borrowedCount + reservedCount` is rejected by the server to prevent negative availability.

### Deleting Books

Book deletion is blocked when any active borrow records (`PENDING` or `BORROWED`) exist for that book. Once all records are resolved, deletion removes the book and all associated historical borrow records.

## Book Availability Tracking

### Counter Mutations

Application code targets the individual counters, never `availableCopies` directly:

```typescript
// User creates a borrow request — reserve one copy atomically
const [updatedBook] = await db
  .update(books)
  .set({ reservedCount: sql`${books.reservedCount} + 1` })
  .where(
    and(
      eq(books.id, bookId),
      // Only succeeds if capacity exists
      sql`${books.reservedCount} + ${books.borrowedCount} < ${books.totalCopies}`,
    ),
  )
  .returning();

// Admin approves a request — convert reservation to active loan
await db.update(books).set({
  reservedCount: sql`GREATEST(0, ${books.reservedCount} - 1)`,
  borrowedCount: sql`${books.borrowedCount} + 1`,
});

// User or admin returns a book — release the active loan
await db.update(books).set({
  borrowedCount: sql`GREATEST(0, ${books.borrowedCount} - 1)`,
});
```

### Availability Status

```typescript
// availableCopies is derived from counters — read it, never write it
const isAvailable = book.availableCopies > 0;
const isLimited   = book.availableCopies > 0 && book.availableCopies <= 2;
const isUnavailable = book.availableCopies === 0;
```

### Real-Time Availability Updates

Users on a book detail page receive live inventory updates via Server-Sent Events without refreshing. The client connects to `/api/book/stream?bookId=<id>` and updates the displayed count whenever a `BOOK_UPDATED` event arrives.

```typescript
// Payload emitted on every counter change
type BookUpdatedMessage = {
  type: "BOOK_UPDATED";
  timestamp: string;
  bookId: string;
  availableCount: number;
  reservedCount: number;
  borrowedCount: number;
};
```

See [Book Availability Realtime](Book_Availability_Realtime.md) for full stream documentation.

## Book Ratings

### Rating System

- 5-star rating scale
- Displayed in book cards and detail views

### Rating Display

```tsx
<StarRating rating={book.rating} readonly />
```

## Multimedia Content

### Cover Images

- Stored on ImageKit CDN
- Optimized for different screen sizes
- Fallback to colored SVG covers using `coverColor`

### Video Trailers

- Hosted on external platforms (YouTube, Vimeo, etc.)
- Embedded in book detail pages
- Optional promotional content

## Book Discovery

### Homepage Display

- Featured books section
- Recently added books
- Popular genres
- Search bar

### Category Browsing

- Books organized by genre
- Alphabetical sorting options
- Pagination for large catalogs

## Performance Optimizations

### Caching

Book queries are served through helpers in `lib/performance/cache.ts`:

```typescript
// Cached helpers — revalidated on book mutations via revalidateTag("books")
getLatestBooksCached()
getBookByIdCached(id)
getSimilarBooksCached(bookId)
getBorrowingEligibilityCached(bookId, userId)
searchBooksCached(query, filters)
```

Tags are revalidated in `lib/admin/actions/book.ts` after any create, update, or delete operation.

### Database Indexing

- Primary key on `id`
- `available_copies_idx` — supports availability-heavy filtering
- Optimized for title/author/genre search queries

### Lazy Loading

- Image lazy loading
- Video loading on demand
- Pagination for large result sets

## Related Components

- `BookCard.tsx` — Book display card
- `BookCover.tsx` — Cover image/SVG component
- `BookList.tsx` — Book grid/list layout
- `BookOverview.tsx` — Detailed book view with real-time availability
- `BookVideo.tsx` — Video trailer component
- `SearchFilter.tsx` — Search and filter controls

## API Endpoints

### Book Retrieval

```typescript
// Get all books (cached, paginated)
GET /api/books

// Get single book
GET /api/books/[id]
```

`availableCopies` in the response is always a computed value derived from `totalCopies - borrowedCount - reservedCount`. Clients should treat it as read-only.

### Admin Operations

Admin book mutations are implemented as **Next.js server actions** in `lib/admin/actions/book.ts`, not as standalone REST endpoints. They are invoked directly from admin form components and are protected by `requireAdminActor()`.

```typescript
// Server actions (not direct API calls)
import { createBook, updateBook, deleteBook } from "@/lib/admin/actions/book";
```
