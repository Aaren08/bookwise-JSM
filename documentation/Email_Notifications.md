# Email Notifications

## Overview

BookWise implements a comprehensive email notification system to keep users informed about account activities, borrowing status, and system updates. The system uses EmailJS for reliable email delivery and Upstash Workflows for scheduled notifications.

## Technology Stack

### Email Service

- **EmailJS** - REST API for email sending
- **Email Templates** - Pre-designed HTML templates
- **Template Parameters** - Dynamic content injection

### Workflow Orchestration

- **Upstash QStash** - Serverless workflow platform
- **Upstash Workflow** - Complex workflow management
- **Scheduled Tasks** - Time-based email triggers

### Configuration

```typescript
// lib/config.ts
export const emailjsConfig = {
  serviceId: process.env.EMAILJS_SERVICE_ID!,
  templateIds: {
    welcome: process.env.EMAILJS_WELCOME_TEMPLATE_ID!,
    approval: process.env.EMAILJS_APPROVAL_TEMPLATE_ID!,
    rejection: process.env.EMAILJS_REJECTION_TEMPLATE_ID!,
    borrowApproved: process.env.EMAILJS_BORROW_APPROVED_TEMPLATE_ID!,
    returnReminder: process.env.EMAILJS_RETURN_REMINDER_TEMPLATE_ID!,
  },
  publicKey: process.env.EMAILJS_PUBLIC_KEY!,
  privateKey: process.env.EMAILJS_PRIVATE_KEY!,
};
```

## Email Templates

### Welcome Email

Sent when user registers:

```html
Subject: Welcome to BookWise Library! Dear {{user_name}}, Welcome to BookWise!
Your account has been created successfully. Your account details: - Email:
{{user_email}} - University ID: {{university_id}} Your account is currently
pending approval. You will receive an email once your account is approved. Best
regards, BookWise Library Team
```

### Account Approval Email

Sent when admin approves account:

```html
Subject: Your BookWise Account is Approved! Dear {{user_name}}, Congratulations!
Your BookWise library account has been approved. You can now: - Browse and
search our book collection - Borrow books online - View your borrowing history -
Update your profile Start exploring: {{library_url}} Best regards, BookWise
Library Team
```

### Account Rejection Email

Sent when admin rejects account:

```html
Subject: BookWise Account Update Dear {{user_name}}, We regret to inform you
that your BookWise library account application has been rejected. If you believe
this is an error, please contact library administration. Best regards, BookWise
Library Team
```

### Borrow Approval Email

Sent when borrow request is approved:

```html
Subject: Your Book Borrow Request is Approved! Dear {{user_name}}, Your request
to borrow "{{book_title}}" by {{book_author}} has been approved. Borrow Details:
- Borrow Date: {{borrow_date}} - Due Date: {{due_date}} - Book: {{book_title}}
Please return the book by the due date to avoid late fees. Best regards,
BookWise Library Team
```

### Return Reminder Email

Sent 3 days before due date:

```html
Subject: Book Return Reminder Dear {{user_name}}, This is a friendly reminder
that "{{book_title}}" is due for return on {{due_date}}. Please return the book
to avoid late fees. Current borrows: {{borrowed_books_list}} Best regards,
BookWise Library Team
```

## Email Sending Implementation

### Basic Email Function

```typescript
// lib/emailjs.ts
export const sendEmail = async (
  templateId: string,
  templateParams: EmailParams,
) => {
  try {
    const response = await fetch(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          service_id: config.env.emailjs.serviceId,
          template_id: templateId,
          user_id: config.env.emailjs.publicKey,
          accessToken: config.env.emailjs.privateKey,
          template_params: templateParams,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`EmailJS API error: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to send email:", error);
    return { success: false, error };
  }
};
```

### Workflow-Based Email Scheduling

```typescript
// lib/workflow.ts
import { Client as WorkflowClient } from "@upstash/workflow";

export const workflowClient = new WorkflowClient({
  baseUrl: config.env.upstash.qstashUrl,
  token: config.env.upstash.qstashToken,
});
```

### Scheduled Reminder Workflow

```typescript
// Trigger return reminder workflow
export const scheduleReturnReminder = async (
  borrowRecordId: string,
  dueDate: Date,
) => {
  // Calculate reminder date (3 days before due date)
  const reminderDate = new Date(dueDate);
  reminderDate.setDate(reminderDate.getDate() - 3);

  await workflowClient.trigger({
    url: `${process.env.APP_URL}/api/workflows/return-reminder`,
    body: { borrowRecordId },
    schedule: reminderDate.toISOString(),
  });
};
```

## Notification Triggers

### User Registration

```typescript
// lib/actions/auth.ts - signUpWithCredentials
export const signUpWithCredentials = async (params) => {
  // Create user account...

  // Send welcome email
  await sendEmail("welcome", {
    user_name: params.fullName,
    user_email: params.email,
    university_id: params.universityId,
  });

  // Schedule return reminders for existing borrows (if any)
  // This is typically not needed for new users
};
```

### Account Approval/Rejection

```typescript
// lib/admin/actions/user.ts
export const updateUserStatus = async (
  userId: string,
  newStatus: UserStatus,
) => {
  // Update user status...

  const user = await db
    .select({ email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (newStatus === "APPROVED") {
    await sendEmail("approval", {
      user_name: user[0].fullName,
      user_email: user[0].email,
      library_url: process.env.APP_URL,
    });
  } else if (newStatus === "REJECTED") {
    await sendEmail("rejection", {
      user_name: user[0].fullName,
      user_email: user[0].email,
    });
  }
};
```

### Borrow Approval

```typescript
// lib/admin/actions/borrow.ts
export const approveBorrowRequest = async (borrowRecordId: string) => {
  // Update borrow status to BORROWED...

  const borrowData = await db
    .select({
      userName: users.fullName,
      userEmail: users.email,
      bookTitle: books.title,
      bookAuthor: books.author,
      borrowDate: borrowRecords.borrowDate,
      dueDate: borrowRecords.dueDate,
    })
    .from(borrowRecords)
    .innerJoin(users, eq(borrowRecords.userId, users.id))
    .innerJoin(books, eq(borrowRecords.bookId, books.id))
    .where(eq(borrowRecords.id, borrowRecordId))
    .limit(1);

  // Send approval email
  await sendEmail("borrow_approved", {
    user_name: borrowData[0].userName,
    user_email: borrowData[0].userEmail,
    book_title: borrowData[0].bookTitle,
    book_author: borrowData[0].bookAuthor,
    borrow_date: formatDate(borrowData[0].borrowDate),
    due_date: formatDate(borrowData[0].dueDate),
  });

  // Schedule return reminder
  await scheduleReturnReminder(borrowRecordId, borrowData[0].dueDate);
};
```

## Workflow API Endpoints

### Return Reminder Workflow

```typescript
// app/api/workflows/return-reminder/route.ts
export async function POST(request: Request) {
  const { borrowRecordId } = await request.json();

  // Check if book is still borrowed and not returned
  const borrowRecord = await db
    .select()
    .from(borrowRecords)
    .where(
      and(
        eq(borrowRecords.id, borrowRecordId),
        eq(borrowRecords.borrowStatus, "BORROWED"),
      ),
    )
    .limit(1);

  if (!borrowRecord.length) {
    return NextResponse.json({ message: "Book already returned" });
  }

  // Get user and book details
  const details = await db
    .select({
      userName: users.fullName,
      userEmail: users.email,
      bookTitle: books.title,
      dueDate: borrowRecords.dueDate,
    })
    .from(borrowRecords)
    .innerJoin(users, eq(borrowRecords.userId, users.id))
    .innerJoin(books, eq(borrowRecords.bookId, books.id))
    .where(eq(borrowRecords.id, borrowRecordId))
    .limit(1);

  // Send reminder email
  await sendEmail("return_reminder", {
    user_name: details[0].userName,
    user_email: details[0].userEmail,
    book_title: details[0].bookTitle,
    due_date: formatDate(details[0].dueDate),
  });

  return NextResponse.json({ message: "Reminder sent" });
}
```

## Email Template Management

### Template Creation

Email templates are created in EmailJS dashboard:

1. **Design HTML Template** - Create responsive HTML with placeholders
2. **Add Dynamic Variables** - Use `{{variable_name}}` syntax
3. **Test Templates** - Send test emails with sample data
4. **Configure SMTP** - Set up email service provider

### Template Variables

Common variables used across templates:

```typescript
interface EmailParams {
  user_name: string;
  user_email: string;
  university_id?: string;
  book_title?: string;
  book_author?: string;
  borrow_date?: string;
  due_date?: string;
  library_url?: string;
  borrowed_books_list?: string;
}
```

## Error Handling and Reliability

### Email Delivery Failures

```typescript
const sendEmailWithRetry = async (
  templateId: string,
  params: EmailParams,
  maxRetries = 3,
) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await sendEmail(templateId, params);
    if (result.success) {
      return result;
    }

    if (attempt < maxRetries) {
      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000),
      );
    }
  }

  // Log failure for manual review
  console.error("Email delivery failed after retries:", {
    templateId,
    params,
  });

  return { success: false, error: "Delivery failed" };
};
```

### Workflow Error Handling

```typescript
// Workflow automatically retries failed steps
// Configure retry policy in Upstash dashboard
const workflowConfig = {
  retries: 3,
  backoff: "exponential",
  maxBackoff: 300000, // 5 minutes
};
```

## Analytics and Monitoring

### Email Delivery Tracking

- Success/failure rates
- Delivery times
- Bounce rates
- Open rates (if supported)

### Workflow Monitoring

- Scheduled task success rates
- Queue depths
- Processing times

## Security Considerations

### Data Privacy

- Emails contain minimal personal information
- No sensitive data in email bodies
- Secure transmission via HTTPS

### Rate Limiting

Email sending is rate limited to prevent abuse:

```typescript
// Rate limit email sending per user
const emailRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "1 h"), // 10 emails per hour per user
});
```

## Cost Optimization

### EmailJS Pricing

- Free tier: 200 emails/month
- Paid plans based on volume
- Optimize by batching notifications

### Workflow Costs

- Upstash QStash pricing based on requests
- Schedule only necessary reminders
- Cancel workflows when no longer needed

## Testing and Development

### Email Testing

```typescript
// Test email sending in development
const testEmail = async () => {
  await sendEmail("welcome", {
    user_name: "Test User",
    user_email: "test@example.com",
    university_id: "123456",
  });
};
```

### Workflow Testing

```typescript
// Test workflow scheduling
const testWorkflow = async () => {
  await workflowClient.trigger({
    url: `${process.env.APP_URL}/api/workflows/test`,
    body: { test: true },
    schedule: new Date(Date.now() + 60000).toISOString(), // 1 minute from now
  });
};
```

## Future Enhancements

### Planned Features

- **Email Preferences** - User-controlled notification settings
- **Bulk Notifications** - Admin broadcast emails
- **Email Templates** - User-customizable designs
- **Delivery Receipts** - Read confirmations
- **SMS Integration** - Alternative notification method

## Related Files

- `lib/emailjs.ts` - Email sending utilities
- `lib/workflow.ts` - Workflow client configuration
- `lib/actions/auth.ts` - Registration email triggers
- `lib/admin/actions/user.ts` - Account status emails
- `lib/admin/actions/borrow.ts` - Borrow approval emails
- `app/api/workflows/return-reminder/route.ts` - Reminder workflow
- `app/api/auth/imagekit/route.ts` - ImageKit authentication</content>
  <parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\Email_Notifications.md
