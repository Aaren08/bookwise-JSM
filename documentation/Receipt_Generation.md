# Receipt Generation

## Overview

BookWise generates PDF receipts for book borrowing transactions. Receipts are produced on demand from a server action that also transitions the borrow record from `PENDING` to `BORROWED`. The PDF is rendered client-side from a formatted receipt object and downloaded directly in the browser — no files are stored on the server.

## Technology Stack

### PDF Generation

- **modern-screenshot** — DOM-to-image capture (replaces html2canvas for better fidelity)
- **jsPDF** — PDF document assembly from the captured image

### Receipt Components

- **`ReceiptModal`** — receipt display and PDF download interface
- **`GenerateReceipt`** — receipt generation trigger button (admin-facing)
- **`downloadReceiptAsPDF`** — client-side PDF creation utility

---

## Receipt Data Structure

The canonical `Receipt` type used across components and server actions:

```typescript
type Receipt = {
  receiptId: string;   // First 8 characters of the borrow record UUID, uppercased
  issuedAt: string;    // Formatted: "DD/MM/YYYY, hh:mm A"
  title: string;       // Book title
  author: string;      // Book author
  genre: string;       // Book genre
  borrowedOn: string;  // Formatted: "DD/MM/YYYY"
  dueDate: string;     // Formatted: "DD/MM/YYYY"
  duration: string;    // e.g. "14 Days"
  userName?: string;   // Borrower's full name
  userEmail?: string;  // Borrower's email address
};
```

### Key Notes

- `receiptId` is derived, not stored. It is the first 8 characters of the borrow record UUID, uppercased (e.g. `"A3F9C1B2"`).
- `duration` is computed differently depending on context:
  - `generateReceipt()` — reads from the current `borrowDurationDays` system setting
  - `getReceipt()` — computes the difference between `dueDate` and `borrowDate` stored in the database, so historical receipts reflect the duration at the time of borrowing rather than the current setting
- When `borrowStatus === "PENDING"`, all date fields in `ReceiptModal` display as `"--/--/----"` and the download button is hidden to prevent generating a misleading receipt before approval.

---

## Server Actions

Both actions live in `lib/admin/actions/receipt.ts`.

### `generateReceipt(borrowRecordId: string)`

Admin-only. Transitions a `PENDING` borrow record to `BORROWED` and returns a formatted `Receipt` object.

**Steps:**

1. Calls `requireAdminActor()` — rejects with an error if the caller is not an admin
2. Fetches the borrow record joined with book and user data
3. Rejects if the record is already `RETURNED` or `LATE_RETURN`
4. Updates the record:
   - `borrowStatus = "BORROWED"`
   - `borrowDate = NOW()`
   - `dueDate = NOW() + borrowDurationDays` (from current system config)
   - `version` incremented via `updateWithVersionCheck()`
5. Revalidates `/admin/borrow-records` path cache
6. Broadcasts admin dashboard update
7. Publishes an `UPDATE` event to the `borrow_requests` realtime channel (best-effort, wrapped in try/catch)
8. Returns a `Receipt` object with all fields formatted

```typescript
// lib/admin/actions/receipt.ts
export const generateReceipt = async (borrowRecordId: string) => {
  const admin = await requireAdminActor();

  const record = await db
    .select({
      id:           borrowRecords.id,
      borrowDate:   borrowRecords.borrowDate,
      dueDate:      borrowRecords.dueDate,
      borrowStatus: borrowRecords.borrowStatus,
      userName:     users.fullName,
      userEmail:    users.email,
      bookTitle:    books.title,
      bookAuthor:   books.author,
      bookGenre:    books.genre,
    })
    .from(borrowRecords)
    .innerJoin(users, eq(borrowRecords.userId, users.id))
    .innerJoin(books, eq(borrowRecords.bookId, books.id))
    .where(eq(borrowRecords.id, borrowRecordId))
    .limit(1);

  if (!record.length) {
    return { success: false, error: "Borrow record not found" };
  }

  if (["RETURNED", "LATE_RETURN"].includes(record[0].borrowStatus)) {
    return { success: false, error: "Cannot generate receipt for a completed record" };
  }

  // Transition PENDING → BORROWED and set dates
  // ... updateWithVersionCheck and counter updates ...

  const receiptId = borrowRecordId.slice(0, 8).toUpperCase();
  const duration  = `${borrowDurationDays} Days`;

  return {
    success: true,
    data: {
      receiptId,
      issuedAt:   format(new Date(), "dd/MM/yyyy, hh:mm a"),
      title:      record[0].bookTitle,
      author:     record[0].bookAuthor,
      genre:      record[0].bookGenre,
      borrowedOn: format(new Date(), "dd/MM/yyyy"),
      dueDate:    format(dueDate, "dd/MM/yyyy"),
      duration,
      userName:   record[0].userName,
      userEmail:  record[0].userEmail,
    } satisfies Receipt,
  };
};
```

### `getReceipt(borrowRecordId: string)`

Fetches a receipt for any borrow record. No admin requirement — used by the user-facing receipt download flow.

```typescript
export const getReceipt = async (borrowRecordId: string) => {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  // Fetch record with joins ...

  // Duration is computed from stored dates, not current system config
  // This ensures historical receipts are accurate even if borrowDurationDays changes
  const durationDays = differenceInDays(
    new Date(record[0].dueDate),
    new Date(record[0].borrowDate),
  );
  const duration = `${durationDays} Days`;

  return { success: true, data: { receiptId, /* ... */ } satisfies Receipt };
};
```

---

## Receipt Modal

`ReceiptModal` displays the receipt in two columns and provides a PDF download button.

```tsx
<ReceiptModal
  isOpen={isModalOpen}
  onClose={() => setIsModalOpen(false)}
  receipt={receipt}
  borrowStatus={borrowStatus}
/>
```

### Layout

- **Left column:** receipt header (logo, receipt ID, date issued), book details (title, author, genre, borrowed on, due date, duration)
- **Right column:** terms and conditions, footer with website URL and support email

The website URL and support email are read from `useSystemConfig()` (Zustand store) so they always reflect the live system configuration set during the setup wizard.

### Pending State

When `borrowStatus === "PENDING"`:

- All date fields display as `"--/--/----"`
- The download button is hidden
- This prevents generating a misleading receipt before admin approval

### Download

The download button calls `downloadReceiptAsPDF(receipt)`. Errors are caught and surfaced as toast notifications via Sonner.

---

## PDF Generation

`downloadReceiptAsPDF` is defined in `lib/essentials/downloadReceipt.ts`:

```typescript
export const downloadReceiptAsPDF = async (receipt: Receipt) => {
  // 1. Find the rendered receipt DOM node
  const receiptElement = document.getElementById("receipt-modal-content");
  if (!receiptElement) throw new Error("Receipt element not found");

  // 2. Capture DOM node as image using modern-screenshot
  const dataUrl = await domToPng(receiptElement, {
    scale: 2,
    backgroundColor: "#ffffff",
  });

  // 3. Create PDF with jsPDF
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const imgWidth  = 210;  // A4 width in mm
  const imgHeight = (receiptElement.offsetHeight * imgWidth) / receiptElement.offsetWidth;

  pdf.addImage(dataUrl, "PNG", 0, 0, imgWidth, imgHeight);
  pdf.save(`receipt-${receipt.receiptId}.pdf`);
};
```

---

## GenerateReceipt Component

Admin-facing trigger that calls `generateReceipt()` and opens the receipt modal:

```tsx
// components/admin/GenerateReceipt.tsx (or similar)
const handleGenerate = async () => {
  const result = await generateReceipt(borrowRecordId);
  if (result.success && result.data) {
    setReceipt(result.data);
    setIsModalOpen(true);
  }
};
```

The component is only rendered when `borrowStatus !== "PENDING"` is false — i.e., it is shown for `PENDING` records (to allow approval + receipt in one step) and hidden for already-terminal statuses.

---

## Rate Limiting

Receipt downloads are rate limited per user + receipt combination to prevent abuse:

```typescript
// lib/essentials/rateLimit.ts
export const receiptMinuteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  prefix:  "ratelimit:receipt:minute",
});

export const receiptDailyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 d"),
  prefix:  "ratelimit:receipt:daily",
});
```

The download API route (`app/api/receipt/download/route.ts`) checks both limits using the key `receipt-download:user:<userId>:receipt:<receiptId>`. Exceeding either limit returns `429 Too Many Requests`.

---

## Authorization

| Action | Who can perform it |
|---|---|
| Generate receipt (PENDING → BORROWED) | Admin only (`requireAdminActor()`) |
| Fetch receipt data | Any authenticated user |
| Download PDF | Any authenticated user (rate limited) |

There is no ownership check on `getReceipt()` — any authenticated user can fetch receipt data for any record ID they know. The PDF download endpoint applies rate limiting per user but does not restrict by ownership. If stricter access control is needed for receipt data, add a `userId` check in `getReceipt()`.

---

## Browser Compatibility

PDF generation relies on `modern-screenshot` (canvas-based DOM capture) and `jsPDF`. Both require a browser environment — they cannot run in server components or API routes.

Supported browsers: Chrome 80+, Firefox 75+, Safari 13+, Edge 80+.

---

## Related Files

- `lib/admin/actions/receipt.ts` — `generateReceipt()`, `getReceipt()`
- `lib/essentials/downloadReceipt.ts` — `downloadReceiptAsPDF()`
- `components/ReceiptModal.tsx` — receipt display and download modal
- `components/admin/GenerateReceipt.tsx` — admin-facing trigger
- `app/api/receipt/download/route.ts` — download API endpoint
- `lib/essentials/rateLimit.ts` — `receiptMinuteRateLimit`, `receiptDailyRateLimit`
- `lib/store/system-config-store.ts` — `useSystemConfig()` for website URL and support email
- `database/schema.ts` — `borrow_records` table
