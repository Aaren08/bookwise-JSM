# Book Catalog

## Overview

BookWise features a comprehensive book catalog system that allows users to browse, search, and discover books in the library. The system supports rich metadata, ratings, availability tracking, and multimedia content including book covers and promotional videos.

## Book Data Model

### Core Fields

```typescript
interface Book {
  id: string; // UUID primary key
  title: string; // Book title (max 255 chars)
  author: string; // Author name (max 255 chars)
  genre: string; // Book category/genre (max 255 chars)
  rating: number; // Average rating (0-5 scale)
  totalCopies: number; // Total physical copies owned
  availableCopies: number; // Currently available copies
  description: string; // Short description/synopsis
  coverColor: string; // Hex color for card background
  coverUrl: string; // Book cover image URL
  videoUrl: string; // Promotional video/trailer URL
  summary: string; // Detailed book summary
  createdAt: Date; // Creation timestamp
}
```

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

Handles book cover display with fallback to colored SVG:

```tsx
<BookCover
  coverColor="#1e40af" // Hex color
  coverImage="/covers/book.jpg" // Optional image URL
/>
```

### BookOverview Component

Detailed book information display with borrowing functionality:

```tsx
<BookOverview book={bookData} userId={currentUser.id} />
```

**Includes:**

- Full book metadata
- Availability status
- Borrow request button
- Rating display
- Video trailer (if available)

## Book Search and Filtering

### Search Functionality

Users can search books by:

- Title (case-insensitive)
- Author (case-insensitive)
- Genre (case-insensitive)

**Implementation:**

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

### SearchFilter Component

Advanced filtering options:

- Genre selection
- Availability status
- Sort by title, author, rating, or date added

## Book Management (Admin Only)

### Creating Books

Admins can add new books through the admin dashboard:

```typescript
// Required fields for book creation
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

### Updating Books

Admins can modify book information:

- Update metadata
- Change cover images/videos
- Adjust copy counts
- Update availability

### Deleting Books

Book deletion with confirmation:

- Checks for active borrow records
- Prevents deletion if books are currently borrowed
- Updates related borrow records

## Book Availability Tracking

### Copy Management

```typescript
// When a book is borrowed
await db
  .update(books)
  .set({ availableCopies: sql`${books.availableCopies} - 1` })
  .where(eq(books.id, bookId));

// When a book is returned
await db
  .update(books)
  .set({ availableCopies: sql`${books.availableCopies} + 1` })
  .where(eq(books.id, bookId));
```

### Availability Status

Books show different states:

- **Available**: `availableCopies > 0`
- **Unavailable**: `availableCopies = 0`
- **Limited**: `availableCopies ≤ 2` (warning state)

## Book Ratings

### Rating System

- 5-star rating scale
- Calculated as average of user ratings
- Displayed in book cards and detail views

### Rating Display

```tsx
// Visual star rating component
<StarRating rating={book.rating} readonly />
```

## Multimedia Content

### Cover Images

- Stored on ImageKit CDN
- Optimized for different screen sizes
- Fallback to colored SVG covers

### Video Trailers

- Hosted on external platforms (YouTube, Vimeo)
- Embedded in book detail pages
- Optional promotional content

## Book Discovery

### Homepage Display

- Featured books section
- Recently added books
- Popular genres
- Search bar with autocomplete

### Category Browsing

- Books organized by genre
- Alphabetical sorting options
- Pagination for large catalogs

## Performance Optimizations

### Database Indexing

- Primary key on `id`
- Composite indexes for search queries
- Optimized for title/author/genre searches

### Caching Strategy

- Static generation for book pages
- Revalidation on updates
- CDN caching for images

### Lazy Loading

- Image lazy loading
- Video loading on demand
- Pagination for large result sets

## Related Components

- `BookCard.tsx` - Book display card
- `BookCover.tsx` - Cover image/SVG component
- `BookList.tsx` - Book grid/list layout
- `BookOverview.tsx` - Detailed book view
- `BookVideo.tsx` - Video trailer component
- `SearchFilter.tsx` - Search and filter controls

## API Endpoints

### Book Retrieval

```typescript
// Get all books with pagination
GET /api/books?page=1&limit=20

// Search books
GET /api/books/search?q=query&genre=fiction

// Get single book
GET /api/books/[id]
```

### Admin Operations

````typescript
// Create book
POST /admin/api/books

// Update book
PUT /admin/api/books/[id]

// Delete book
DELETE /admin/api/books/[id]
```</content>
<parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\Book_Catalog.md
````
