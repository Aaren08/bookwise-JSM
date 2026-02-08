# Borrowing System

## Overview

The borrowing system in BookWise manages the complete lifecycle of book loans, from request to return. It includes eligibility checking, status tracking, due date management, and automated workflows for library operations.

## Borrow Record Data Model

```typescript
interface BorrowRecord {
  id: string; // UUID primary key
  userId: string; // Foreign key to users table
  bookId: string; // Foreign key to books table
  borrowDate: Date; // When borrow was initiated
  dueDate: Date; // When book should be returned
  returnDate?: Date; // When book was actually returned
  borrowStatus: BorrowStatus; // Current status
  dismissed: number; // User dismissal flag (0/1)
  createdAt: Date; // Record creation timestamp
}

type BorrowStatus = "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
```

## Borrowing Flow

### 1. Borrow Request

Users initiate borrow requests through the book detail page:

```typescript
const result = await borrowBook({ userId, bookId });
```

**Process:**

- Check book availability (`availableCopies > 0`)
- Verify user eligibility
- Prevent duplicate active requests
- Create borrow record with `PENDING` status
- Set due date (default: 14 days from borrow date)

### 2. Admin Approval

Admins review and approve borrow requests:

```typescript
// Update status to BORROWED
await db
  .update(borrowRecords)
  .set({
    borrowStatus: "BORROWED",
    borrowDate: new Date(),
  })
  .where(eq(borrowRecords.id, recordId));

// Decrease available copies
await db
  .update(books)
  .set({ availableCopies: sql`${books.availableCopies} - 1` })
  .where(eq(books.id, bookId));
```

### 3. Book Return

Users return books through their profile or admin dashboard:

```typescript
// Update borrow record
await db
  .update(borrowRecords)
  .set({
    borrowStatus: "RETURNED",
    returnDate: new Date(),
  })
  .where(eq(borrowRecords.id, recordId));

// Increase available copies
await db
  .update(books)
  .set({ availableCopies: sql`${books.availableCopies} + 1` })
  .where(eq(books.id, bookId));
```

## Eligibility Checking

### BorrowingEligibility Interface

```typescript
interface BorrowingEligibility {
  isEligible: boolean;
  message: string;
}
```

### Eligibility Criteria

1. **User Status**: Must be `APPROVED`
2. **Book Availability**: `availableCopies > 0`
3. **No Active Borrow**: No current `PENDING` or `BORROWED` record for same book
4. **Account Status**: User account not rejected

### Eligibility Check Implementation

```typescript
const checkBorrowingEligibility = async (
  userId: string,
  bookId: string,
): Promise<BorrowingEligibility> => {
  // Check user status
  const user = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user[0]?.status !== "APPROVED") {
    return {
      isEligible: false,
      message: "Your account must be approved to borrow books.",
    };
  }

  // Check book availability
  const book = await db
    .select({ availableCopies: books.availableCopies })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  if (!book.length || book[0].availableCopies <= 0) {
    return {
      isEligible: false,
      message: "This book is currently unavailable.",
    };
  }

  // Check for existing active borrow
  const existingBorrow = await db
    .select()
    .from(borrowRecords)
    .where(
      and(
        eq(borrowRecords.userId, userId),
        eq(borrowRecords.bookId, bookId),
        or(
          eq(borrowRecords.borrowStatus, "PENDING"),
          eq(borrowRecords.borrowStatus, "BORROWED"),
        ),
      ),
    )
    .limit(1);

  if (existingBorrow.length > 0) {
    return {
      isEligible: false,
      message: "You already have a pending request or borrowed this book.",
    };
  }

  return { isEligible: true, message: "Eligible to borrow" };
};
```

## Due Date Management

### Default Loan Period

- **Standard Period**: 14 days from borrow date
- **Configurable**: Can be adjusted per book or user type

### Due Date Calculation

```typescript
const dueDate = dayjs(borrowDate).add(14, "days").toDate();
```

### Late Returns

- Automatically detected when `returnDate > dueDate`
- Status updated to `LATE_RETURN`
- May trigger penalty workflows

## Borrow Record Management

### Status Transitions

```
PENDING → BORROWED (admin approval)
PENDING → CANCELLED (user/admin cancellation)
BORROWED → RETURNED (normal return)
BORROWED → LATE_RETURN (overdue return)
```

### Record Dismissal

Users can dismiss completed records from their view:

```typescript
await db
  .update(borrowRecords)
  .set({ dismissed: 1 })
  .where(
    and(
      eq(borrowRecords.userId, userId),
      eq(borrowRecords.id, recordId),
      or(
        eq(borrowRecords.borrowStatus, "RETURNED"),
        eq(borrowRecords.borrowStatus, "LATE_RETURN"),
      ),
    ),
  );
```

## Admin Dashboard Features

### Borrow Records Table

Displays all borrow records with filtering and sorting:

- Filter by status, user, book, date range
- Sort by borrow date, due date, return date
- Bulk operations for status updates

### Status Management

Admins can update borrow statuses:

```typescript
// Approve pending request
await updateBorrowStatus(recordId, "BORROWED");

// Mark as returned
await updateBorrowStatus(recordId, "RETURNED");
```

### Bulk Operations

- Approve multiple pending requests
- Mark multiple books as returned
- Generate receipts for completed borrows

## User Dashboard Features

### My Borrowed Books

Users can view their borrow history:

- Current borrows (PENDING, BORROWED)
- Past borrows (RETURNED, LATE_RETURN)
- Due dates and overdue warnings
- Dismiss completed records

### Borrow History

Detailed view of all borrowing activity:

- Borrow date and due date
- Return date (if applicable)
- Book details
- Receipt download (for completed borrows)

## Notifications and Alerts

### Due Date Reminders

- Email notifications 3 days before due date
- Dashboard warnings for overdue books
- Push notifications (future feature)

### Status Updates

- Email confirmation when request approved
- Notifications for overdue books
- Return confirmation emails

## Receipt Generation

### Receipt Data Structure

```typescript
interface Receipt {
  borrowRecordId: string;
  userName: string;
  userEmail: string;
  bookTitle: string;
  bookAuthor: string;
  borrowDate: Date;
  dueDate: Date;
  returnDate?: Date;
  status: BorrowStatus;
  generatedAt: Date;
}
```

### PDF Generation

Uses jsPDF and html2canvas for receipt creation:

```typescript
const generateReceipt = async (borrowRecordId: string) => {
  // Fetch borrow record with user and book details
  const receiptData = await getReceiptData(borrowRecordId);

  // Generate PDF
  const pdf = new jsPDF();
  // Add receipt content...
  return pdf.output("blob");
};
```

## Analytics and Reporting

### Borrow Statistics

- Total active borrows
- Overdue books count
- Popular books by borrow count
- User borrowing patterns

### Usage Reports

- Monthly borrowing trends
- Peak borrowing periods
- Book utilization rates

## Security Considerations

### Authorization Checks

- Users can only view/modify their own records
- Admins can view all records
- Server-side validation for all operations

### Rate Limiting

- Borrow request limits per user
- Prevents abuse of the borrowing system

## API Endpoints

### User Operations

```typescript
// Request to borrow a book
POST / api / books / [id] / borrow;

// View user's borrow records
GET / api / user / borrow - records;

// Dismiss a borrow record
PUT / api / borrow - records / [id] / dismiss;
```

### Admin Operations

```typescript
// Get all borrow records
GET / admin / api / borrow - records;

// Update borrow status
PUT / admin / api / borrow - records / [id] / status;

// Generate receipt
POST / admin / api / receipts / generate;
```

## Related Components

- `BorrowBook.tsx` - Borrow request button
- `BorrowedBookCard.tsx` - Borrow record display
- `GenerateReceipt.tsx` - Receipt generation
- `ReceiptModal.tsx` - Receipt display modal
- `BorrowRecordsTable.tsx` - Admin borrow records table</content>
  <parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\Borrowing_System.md
