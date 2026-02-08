# API Reference

## Overview

BookWise provides a comprehensive REST API for client-server communication. The API is built using Next.js API routes with TypeScript for type safety and automatic documentation generation.

## API Structure

### Base URL

```
https://your-domain.vercel.app/api
```

### Authentication

All API endpoints require authentication except public routes. Authentication is handled via NextAuth.js JWT tokens.

### Response Format

```typescript
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
```

## Authentication Endpoints

### NextAuth.js Handlers

#### GET/POST /api/auth/[...nextauth]

NextAuth.js authentication handlers for sign-in, sign-out, and session management.

**Supported Providers:**

- Credentials (email/password)

**Session Management:**

```typescript
// Get current session
const session = await auth();

// Sign in
await signIn("credentials", { email, password });

// Sign out
await signOut();
```

### ImageKit Authentication

#### GET /api/auth/imagekit

Provides authentication parameters for client-side file uploads.

**Response:**

```json
{
  "signature": "signature_string",
  "expire": 1640000000,
  "token": "token_string",
  "publicKey": "public_key"
}
```

## User Management Endpoints

### Profile Operations

#### GET /api/user/profile

Get current user profile information.

**Authentication:** Required
**Method:** GET

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "user-id",
    "fullName": "John Doe",
    "email": "john@example.com",
    "universityId": "123456",
    "userAvatar": "https://...",
    "status": "APPROVED",
    "role": "USER",
    "lastActivityDate": "2024-01-01T00:00:00Z",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### PUT /api/user/profile

Update user profile information.

**Authentication:** Required
**Method:** PUT
**Body:**

```json
{
  "fullName": "Updated Name",
  "userAvatar": "https://...",
  "userAvatarFileId": "file-id"
}
```

### Avatar Management

#### PUT /api/avatar

Update user avatar.

**Authentication:** Required
**Method:** PUT
**Rate Limit:** 5 updates per day
**Body:**

```json
{
  "avatar": "https://image-url",
  "fileId": "imagekit-file-id"
}
```

## Book Management Endpoints

### Book Retrieval

#### GET /api/books

Get paginated list of books.

**Authentication:** Required
**Method:** GET
**Query Parameters:**

- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)
- `search` (string): Search query
- `genre` (string): Filter by genre

**Response:**

```json
{
  "success": true,
  "data": {
    "books": [...],
    "totalPages": 10,
    "currentPage": 1,
    "totalBooks": 200
  }
}
```

#### GET /api/books/[id]

Get detailed information about a specific book.

**Authentication:** Required
**Method:** GET
**Parameters:**

- `id` (string): Book UUID

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "book-id",
    "title": "Book Title",
    "author": "Author Name",
    "genre": "Fiction",
    "rating": 4.5,
    "totalCopies": 10,
    "availableCopies": 7,
    "description": "Book description",
    "coverColor": "#3b82f6",
    "coverUrl": "https://...",
    "videoUrl": "https://...",
    "summary": "Detailed summary",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### GET /api/books/search

Search books with advanced filtering.

**Authentication:** Required
**Method:** GET
**Query Parameters:**

- `q` (string): Search query
- `genre` (string): Filter by genre
- `available` (boolean): Only available books

### Book Borrowing

#### POST /api/books/[id]/borrow

Request to borrow a book.

**Authentication:** Required
**Method:** POST
**Parameters:**

- `id` (string): Book UUID

**Response:**

```json
{
  "success": true,
  "message": "Borrow request submitted successfully"
}
```

## Borrow Record Endpoints

### User Borrow Records

#### GET /api/user/borrow-records

Get current user's borrow records.

**Authentication:** Required
**Method:** GET

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "record-id",
      "bookId": "book-id",
      "bookTitle": "Book Title",
      "borrowDate": "2024-01-01T00:00:00Z",
      "dueDate": "2024-01-15T00:00:00Z",
      "returnDate": null,
      "borrowStatus": "BORROWED",
      "dismissed": 0
    }
  ]
}
```

#### PUT /api/borrow-records/[id]/dismiss

Dismiss a completed borrow record from user's view.

**Authentication:** Required (owner only)
**Method:** PUT
**Parameters:**

- `id` (string): Borrow record UUID

## Receipt Endpoints

### Receipt Download

#### POST /api/receipt/download

Check if receipt download is allowed and prepare for download.

**Authentication:** Required
**Method:** POST
**Rate Limit:** 5 per minute, 10 per day
**Body:**

```json
{
  "receiptId": "borrow-record-id"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "allowed": true,
    "reset": 1640000000000
  }
}
```

## Admin Endpoints

### User Management

#### GET /admin/api/users

Get paginated list of all users.

**Authentication:** Admin required
**Method:** GET
**Query Parameters:**

- `page` (number): Page number
- `limit` (number): Items per page
- `search` (string): Search by name/email/ID
- `status` (string): Filter by status

#### PUT /admin/api/users/[id]/status

Update user account status.

**Authentication:** Admin required
**Method:** PUT
**Parameters:**

- `id` (string): User UUID
  **Body:**

```json
{
  "status": "APPROVED" | "REJECTED"
}
```

#### PUT /admin/api/users/[id]/role

Update user role.

**Authentication:** Admin required
**Method:** PUT
**Parameters:**

- `id` (string): User UUID
  **Body:**

```json
{
  "role": "USER" | "ADMIN"
}
```

#### DELETE /admin/api/users/[id]

Delete user account.

**Authentication:** Admin required
**Method:** DELETE
**Parameters:**

- `id` (string): User UUID

### Book Management

#### GET /admin/api/books

Get paginated list of all books for admin management.

**Authentication:** Admin required
**Method:** GET
**Query Parameters:**

- `page` (number): Page number
- `limit` (number): Items per page
- `search` (string): Search query

#### POST /admin/api/books

Create a new book.

**Authentication:** Admin required
**Method:** POST
**Body:**

```json
{
  "title": "Book Title",
  "author": "Author Name",
  "genre": "Fiction",
  "totalCopies": 5,
  "description": "Book description",
  "coverColor": "#3b82f6",
  "coverUrl": "https://...",
  "videoUrl": "https://...",
  "summary": "Detailed summary"
}
```

#### PUT /admin/api/books/[id]

Update book information.

**Authentication:** Admin required
**Method:** PUT
**Parameters:**

- `id` (string): Book UUID
  **Body:** (same as create)

#### DELETE /admin/api/books/[id]

Delete a book.

**Authentication:** Admin required
**Method:** DELETE
**Parameters:**

- `id` (string): Book UUID

### Borrow Record Management

#### GET /admin/api/borrow-records

Get all borrow records for admin management.

**Authentication:** Admin required
**Method:** GET
**Query Parameters:**

- `page` (number): Page number
- `limit` (number): Items per page
- `status` (string): Filter by status
- `userId` (string): Filter by user
- `bookId` (string): Filter by book

#### PUT /admin/api/borrow-records/[id]/status

Update borrow record status.

**Authentication:** Admin required
**Method:** PUT
**Parameters:**

- `id` (string): Borrow record UUID
  **Body:**

```json
{
  "status": "BORROWED" | "RETURNED"
}
```

### Receipt Generation

#### POST /admin/api/receipts/generate

Generate a receipt for a borrow record.

**Authentication:** Admin required
**Method:** POST
**Body:**

```json
{
  "borrowRecordId": "record-id"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "receiptNumber": "BW-ABC123",
    "userName": "John Doe",
    "bookTitle": "Book Title"
    // ... receipt data
  }
}
```

### Dashboard Data

#### GET /admin/api/dashboard/stats

Get dashboard statistics.

**Authentication:** Admin required
**Method:** GET

**Response:**

```json
{
  "success": true,
  "data": {
    "totalBooks": 150,
    "totalUsers": 45,
    "borrowedBooks": 23
  }
}
```

#### GET /admin/api/dashboard/activity

Get recent system activity.

**Authentication:** Admin required
**Method:** GET

## Workflow Endpoints

### Return Reminder

#### POST /api/workflows/return-reminder

Internal endpoint for scheduled return reminders.

**Authentication:** Internal (QStash)
**Method:** POST
**Body:**

```json
{
  "borrowRecordId": "record-id"
}
```

## Error Responses

### Common Error Codes

#### 400 Bad Request

```json
{
  "success": false,
  "error": "Invalid request parameters"
}
```

#### 401 Unauthorized

```json
{
  "success": false,
  "error": "Authentication required"
}
```

#### 403 Forbidden

```json
{
  "success": false,
  "error": "Insufficient permissions"
}
```

#### 404 Not Found

```json
{
  "success": false,
  "error": "Resource not found"
}
```

#### 429 Too Many Requests

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "reset": 1640000000000
}
```

#### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Internal server error"
}
```

## Rate Limiting

### Rate Limit Headers

API responses include rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1640000000
```

### Rate Limits by Endpoint

| Endpoint         | Limit         | Window             |
| ---------------- | ------------- | ------------------ |
| Authentication   | 5             | 1 minute           |
| Avatar upload    | 10            | 1 day              |
| Avatar update    | 5             | 1 day              |
| Receipt download | 5/min, 10/day | per user + receipt |

## Pagination

### Pagination Parameters

- `page`: Page number (1-based)
- `limit`: Items per page (max 100)

### Pagination Response

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8
    }
  }
}
```

## Data Types

### User Status

```typescript
type UserStatus = "PENDING" | "APPROVED" | "REJECTED";
```

### User Role

```typescript
type UserRole = "USER" | "ADMIN";
```

### Borrow Status

```typescript
type BorrowStatus = "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
```

### Book Genre

```typescript
type BookGenre = string; // Free-form text
```

## SDK Usage

### JavaScript Client Example

```javascript
// Authentication
const response = await fetch("/api/auth/signin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

// Get books
const books = await fetch("/api/books?page=1&limit=20");
const data = await books.json();

// Borrow a book
const borrow = await fetch(`/api/books/${bookId}/borrow`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

## Testing

### API Testing Tools

- **Postman** - GUI API testing
- **Insomnia** - API client
- **curl** - Command line testing

### Test Data

Use the seed script to populate test data:

```bash
npm run seed
```

## Versioning

### API Versioning

The API is versioned through URL paths:

```
/api/v1/books    # Future versioning
/api/books       # Current version
```

## Support

### Getting Help

- Check the [API documentation](./API_Reference.md)
- Review [error handling](./Error_Handling.md)
- Contact development team for support

## Changelog

### v1.0.0

- Initial API release
- Basic CRUD operations for books and users
- Authentication and authorization
- Borrow record management
- Receipt generation</content>
  <parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\API_Reference.md
