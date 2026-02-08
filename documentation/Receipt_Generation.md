# Receipt Generation

## Overview

BookWise includes a comprehensive receipt generation system that creates PDF receipts for completed book borrowing transactions. The system uses client-side PDF generation with modern web technologies to provide users and admins with official borrowing records.

## Technology Stack

### PDF Generation

- **jsPDF** - PDF document creation
- **html2canvas** - HTML to canvas conversion
- **modern-screenshot** - Enhanced screenshot capabilities

### Receipt Components

- **ReceiptModal** - Receipt display and download interface
- **GenerateReceipt** - Receipt generation trigger
- **ReceiptButton** - Download button component

## Receipt Data Structure

### Receipt Interface

```typescript
interface Receipt {
  borrowRecordId: string;
  userName: string;
  userEmail: string;
  universityId: string;
  bookTitle: string;
  bookAuthor: string;
  bookGenre: string;
  borrowDate: Date;
  dueDate: Date;
  returnDate?: Date;
  borrowStatus: BorrowStatus;
  generatedAt: Date;
  receiptNumber: string;
}
```

### Receipt Generation Process

1. **Data Fetching**: Retrieve borrow record with user and book details
2. **Data Formatting**: Format dates and generate receipt number
3. **HTML Rendering**: Create styled HTML receipt template
4. **Canvas Conversion**: Convert HTML to canvas image
5. **PDF Creation**: Add canvas to PDF document
6. **Download**: Trigger browser download

## Receipt Template

### HTML Structure

```html
<div class="receipt-container">
  <header class="receipt-header">
    <h1>BookWise Library</h1>
    <h2>Borrowing Receipt</h2>
  </header>

  <section class="receipt-details">
    <div class="receipt-info">
      <p><strong>Receipt #:</strong> {receiptNumber}</p>
      <p><strong>Generated:</strong> {generatedAt}</p>
    </div>

    <div class="user-info">
      <h3>Borrower Information</h3>
      <p><strong>Name:</strong> {userName}</p>
      <p><strong>Email:</strong> {userEmail}</p>
      <p><strong>University ID:</strong> {universityId}</p>
    </div>

    <div class="book-info">
      <h3>Book Information</h3>
      <p><strong>Title:</strong> {bookTitle}</p>
      <p><strong>Author:</strong> {bookAuthor}</p>
      <p><strong>Genre:</strong> {bookGenre}</p>
    </div>

    <div class="borrow-info">
      <h3>Borrowing Details</h3>
      <p><strong>Borrow Date:</strong> {borrowDate}</p>
      <p><strong>Due Date:</strong> {dueDate}</p>
      <p><strong>Return Date:</strong> {returnDate || 'Not returned'}</p>
      <p><strong>Status:</strong> {borrowStatus}</p>
    </div>
  </section>

  <footer class="receipt-footer">
    <p>Thank you for using BookWise Library!</p>
    <p>This receipt was generated on {generatedAt}</p>
  </footer>
</div>
```

### Styling

Receipts use custom CSS for professional appearance:

```css
.receipt-container {
  font-family: "Arial", sans-serif;
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  border: 2px solid #333;
  background: white;
}

.receipt-header {
  text-align: center;
  border-bottom: 2px solid #333;
  padding-bottom: 20px;
  margin-bottom: 30px;
}

.receipt-header h1 {
  color: #1e40af;
  font-size: 24px;
  margin: 0;
}

.receipt-details {
  margin-bottom: 30px;
}

.receipt-info,
.user-info,
.book-info,
.borrow-info {
  margin-bottom: 20px;
}

.receipt-footer {
  text-align: center;
  border-top: 1px solid #ccc;
  padding-top: 20px;
  font-size: 12px;
  color: #666;
}
```

## Generation Workflow

### Server-Side Data Preparation

```typescript
// lib/admin/actions/receipt.ts
export const generateReceipt = async (borrowRecordId: string) => {
  // Fetch borrow record with joins
  const record = await db
    .select({
      id: borrowRecords.id,
      borrowDate: borrowRecords.borrowDate,
      dueDate: borrowRecords.dueDate,
      returnDate: borrowRecords.returnDate,
      borrowStatus: borrowRecords.borrowStatus,
      userName: users.fullName,
      userEmail: users.email,
      universityId: users.universityId,
      bookTitle: books.title,
      bookAuthor: books.author,
      bookGenre: books.genre,
    })
    .from(borrowRecords)
    .innerJoin(users, eq(borrowRecords.userId, users.id))
    .innerJoin(books, eq(borrowRecords.bookId, books.id))
    .where(eq(borrowRecords.id, borrowRecordId))
    .limit(1);

  if (!record.length) {
    return { success: false, error: "Borrow record not found" };
  }

  // Generate receipt number
  const receiptNumber = `BW-${borrowRecordId.slice(-8).toUpperCase()}`;

  return {
    success: true,
    data: {
      ...record[0],
      receiptNumber,
      generatedAt: new Date(),
    },
  };
};
```

### Client-Side PDF Creation

```typescript
// components/admin/GenerateReceipt.tsx
const handleGenerate = async () => {
  const res = await generateReceipt(borrowRecordId);
  if (res.success && res.data) {
    setReceipt(res.data as Receipt);
    setIsModalOpen(true);
  }
};
```

### PDF Generation Function

```typescript
// lib/essentials/downloadReceipt.ts
export const downloadReceipt = async (receipt: Receipt) => {
  // Create HTML content
  const htmlContent = generateReceiptHTML(receipt);

  // Convert to canvas
  const canvas = await html2canvas(htmlContent, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
  });

  // Create PDF
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const imgData = canvas.toDataURL("image/png");
  const imgWidth = 210; // A4 width in mm
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
  pdf.save(`receipt-${receipt.receiptNumber}.pdf`);
};
```

## Receipt Modal

### Modal Interface

```tsx
<ReceiptModal
  isOpen={isModalOpen}
  onClose={() => setIsModalOpen(false)}
  receipt={receipt}
  borrowStatus={status}
/>
```

### Modal Features

- **Preview**: Shows receipt content before download
- **Download Button**: Triggers PDF generation and download
- **Print Option**: Browser print functionality
- **Responsive Design**: Works on mobile and desktop

## Rate Limiting

### Download Limits

Receipt downloads are rate limited to prevent abuse:

```typescript
// Per user + receipt combination
const key = `receipt-download:user:${session.user.id}:receipt:${receiptId}`;

// Minute limit: 5 downloads
const minuteLimit = await receiptMinuteRateLimit.limit(key);

// Daily limit: 10 downloads
const dailyLimit = await receiptDailyRateLimit.limit(key);
```

### Rate Limit Response

```typescript
if (!minuteLimit.success) {
  return NextResponse.json(
    {
      error: "You are downloading this receipt too frequently.",
      reset: minuteLimit.reset,
    },
    { status: 429 },
  );
}
```

## Receipt Storage

### Database Tracking

Receipt generation is tracked but not stored:

- Generation timestamps logged
- Download counts tracked (future feature)
- No persistent receipt storage

### File Management

- PDFs generated on-demand
- No server-side storage
- Client-side download only

## Security Considerations

### Authorization Checks

```typescript
// Only admins or record owner can generate receipts
if (!session?.user?.id || session.user.role !== "ADMIN") {
  // Check if user owns the borrow record
  const isOwner = await db
    .select()
    .from(borrowRecords)
    .where(
      and(
        eq(borrowRecords.id, borrowRecordId),
        eq(borrowRecords.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!isOwner.length) {
    return { success: false, error: "Unauthorized" };
  }
}
```

### Data Validation

- Server-side validation of borrow record existence
- Sanitization of user input data
- XSS protection in HTML generation

## Error Handling

### Generation Errors

```typescript
try {
  const pdf = await downloadReceipt(receipt);
} catch (error) {
  console.error("Receipt generation failed:", error);
  showErrorToast("Failed to generate receipt");
}
```

### Common Issues

- Canvas rendering failures
- Memory limits for large receipts
- Browser compatibility issues
- Network timeouts

## Performance Optimization

### Lazy Loading

- Receipt modal loads on demand
- PDF generation triggered by user action
- No pre-rendering of receipts

### Memory Management

- Canvas cleanup after PDF generation
- Garbage collection of large images
- Chunked processing for large receipts

## Browser Compatibility

### Supported Browsers

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### Fallback Options

- Print functionality as alternative
- Email receipts (future feature)
- Download restrictions for unsupported browsers

## Analytics and Monitoring

### Usage Tracking

- Receipt generation counts
- Download success/failure rates
- User engagement metrics

### Performance Monitoring

- Generation time tracking
- Error rate monitoring
- Resource usage statistics

## Future Enhancements

### Planned Features

- **Email Receipts**: Send receipts via email
- **Digital Signatures**: Cryptographic signing
- **QR Codes**: Quick access codes
- **Bulk Generation**: Multiple receipts at once
- **Custom Templates**: User-customizable designs

## Related Files

- `components/ReceiptModal.tsx` - Receipt display modal
- `components/ReceiptButton.tsx` - Download button component
- `lib/admin/actions/receipt.ts` - Receipt generation logic
- `lib/essentials/downloadReceipt.ts` - PDF creation utilities
- `styles/receipt.css` - Receipt styling
- `app/api/receipt/download/route.ts` - Download API endpoint</content>
  <parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\Receipt_Generation.md
