# Email Notifications

## Overview

BookWise sends transactional emails to keep users informed about account status changes and borrowing activity. Email delivery uses EmailJS via a direct REST call. Time-delayed notifications (return reminders) are orchestrated through Upstash Workflow, which schedules a deferred HTTP callback without blocking the originating server action.

---

## Technology Stack

### Email Delivery

- **EmailJS** — REST API for server-side email sending
- **Email templates** — Pre-designed HTML templates configured in the EmailJS dashboard
- **Template parameters** — Dynamic content injected at send time

### Workflow Orchestration

- **Upstash QStash** — Durable message queue for deferred execution
- **Upstash Workflow** — Serverless workflow engine using `serve()` + `context.sleep()` for time-based steps

### Configuration

```typescript
// lib/config.ts
export const config = {
  env: {
    emailjs: {
      serviceId:               process.env.EMAILJS_SERVICE_ID!,
      publicKey:               process.env.EMAILJS_PUBLIC_KEY!,
      privateKey:              process.env.EMAILJS_PRIVATE_KEY!,
      welcomeTemplateId:       process.env.EMAILJS_WELCOME_TEMPLATE_ID!,
      approvalTemplateId:      process.env.EMAILJS_APPROVAL_TEMPLATE_ID!,
      rejectionTemplateId:     process.env.EMAILJS_REJECTION_TEMPLATE_ID!,
      borrowApprovedTemplateId:process.env.EMAILJS_BORROW_APPROVED_TEMPLATE_ID!,
      returnReminderTemplateId:process.env.EMAILJS_RETURN_REMINDER_TEMPLATE_ID!,
    },
  },
};
```

---

## Email Sending Implementation

All emails are sent through the `sendEmail` utility in `lib/emailjs.ts`:

```typescript
// lib/emailjs.ts
export const sendEmail = async (
  templateId: string,
  templateParams: Record<string, string>,
): Promise<{ success: boolean; error?: unknown }> => {
  try {
    const response = await fetch(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id:      config.env.emailjs.serviceId,
          template_id:     templateId,
          user_id:         config.env.emailjs.publicKey,
          accessToken:     config.env.emailjs.privateKey,
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

Email sending is **fire-and-forget** in most trigger paths — a failed email does not roll back the originating database operation.

---

## Workflow Client

Long-running or time-delayed email flows use the Upstash Workflow client:

```typescript
// lib/workflow.ts
import { Client as WorkflowClient } from "@upstash/workflow";

export const workflowClient = new WorkflowClient({
  baseUrl: config.env.upstash.qstashUrl,
  token:   config.env.upstash.qstashToken,
});
```

Workflows are defined as Next.js route handlers using `serve()` from `@upstash/workflow/nextjs`. Steps inside a workflow survive server restarts because QStash re-delivers the HTTP callback if the step has not been acknowledged.

---

## Email Templates

Templates are created and managed in the EmailJS dashboard. Variables use `{{variable_name}}` syntax.

### Welcome Email

**Trigger:** user completes sign-up  
**Template ID env var:** `EMAILJS_WELCOME_TEMPLATE_ID`

**Variables:** `user_name`, `user_email`, `university_id`

```
Subject: Welcome to BookWise Library!

Dear {{user_name}},

Welcome to BookWise! Your account has been created successfully.

Your account is currently pending approval. You will receive an
email once an administrator has reviewed your application.

Best regards,
BookWise Library Team
```

### Account Approval Email

**Trigger:** admin approves a pending account  
**Template ID env var:** `EMAILJS_APPROVAL_TEMPLATE_ID`

**Variables:** `user_name`, `user_email`, `library_url`

```
Subject: Your BookWise Account is Approved!

Dear {{user_name}},

Congratulations! Your BookWise library account has been approved.
You can now browse the catalog and borrow books.

Visit the library: {{library_url}}

Best regards,
BookWise Library Team
```

### Account Rejection Email

**Trigger:** admin rejects a pending account  
**Template ID env var:** `EMAILJS_REJECTION_TEMPLATE_ID`

**Variables:** `user_name`, `user_email`

```
Subject: BookWise Account Update

Dear {{user_name}},

We regret to inform you that your BookWise library account
application has not been approved at this time.

If you believe this is an error, please contact library administration.

Best regards,
BookWise Library Team
```

### Borrow Approval Email

**Trigger:** admin generates a receipt (transitions PENDING → BORROWED)  
**Template ID env var:** `EMAILJS_BORROW_APPROVED_TEMPLATE_ID`

**Variables:** `user_name`, `user_email`, `book_title`, `book_author`, `borrow_date`, `due_date`

```
Subject: Your Book Borrow Request is Approved!

Dear {{user_name}},

Your request to borrow "{{book_title}}" by {{book_author}} has been approved.

Borrow Date: {{borrow_date}}
Due Date:    {{due_date}}

Please return the book by the due date.

Best regards,
BookWise Library Team
```

### Return Reminder Email

**Trigger:** scheduled 3 days before the due date via Upstash Workflow  
**Template ID env var:** `EMAILJS_RETURN_REMINDER_TEMPLATE_ID`

**Variables:** `user_name`, `user_email`, `book_title`, `due_date`

```
Subject: Book Return Reminder

Dear {{user_name}},

This is a friendly reminder that "{{book_title}}" is due for
return on {{due_date}}.

Please return the book to avoid late fees.

Best regards,
BookWise Library Team
```

---

## Notification Triggers

### User Registration

Called from `lib/actions/auth.ts` — `signUpWithCredentials()`:

```typescript
// Fire-and-forget: email failure does not block sign-up
void sendEmail(config.env.emailjs.welcomeTemplateId, {
  user_name:     params.fullName,
  user_email:    params.email,
  university_id: params.universityId,
}).catch(console.error);

// Trigger return-reminder workflow via QStash (also fire-and-forget)
void workflowClient.trigger({
  url:  `${config.env.appUrl}/api/workflows/send-welcome`,
  body: JSON.stringify({ userId }),
}).catch(console.error);
```

### Account Approval / Rejection

Called from `lib/admin/actions/user.ts` — `approveAccount()` and `rejectAccount()`:

```typescript
// After DB update succeeds, send notification email
if (newStatus === "APPROVED") {
  void sendEmail(config.env.emailjs.approvalTemplateId, {
    user_name:   user.fullName,
    user_email:  user.email,
    library_url: config.env.appUrl,
  }).catch(console.error);
} else if (newStatus === "REJECTED") {
  void sendEmail(config.env.emailjs.rejectionTemplateId, {
    user_name:  user.fullName,
    user_email: user.email,
  }).catch(console.error);
}
```

### Borrow Approval

Called from `lib/admin/actions/receipt.ts` — `generateReceipt()`:

```typescript
// After PENDING → BORROWED transition
void sendEmail(config.env.emailjs.borrowApprovedTemplateId, {
  user_name:   borrowData.userName,
  user_email:  borrowData.userEmail,
  book_title:  borrowData.bookTitle,
  book_author: borrowData.bookAuthor,
  borrow_date: format(new Date(), "dd/MM/yyyy"),
  due_date:    format(dueDate, "dd/MM/yyyy"),
}).catch(console.error);

// Schedule return reminder via Upstash Workflow
void workflowClient.trigger({
  url:  `${config.env.appUrl}/api/workflows/return-reminder`,
  body: JSON.stringify({ borrowRecordId }),
}).catch(console.error);
```

---

## Workflow API Endpoints

### Return Reminder Workflow

**File:** `app/api/workflows/return-reminder/route.ts`

Upstash Workflow uses `serve()` to define a durable multi-step function. QStash re-delivers HTTP callbacks for each step, so the workflow survives server restarts.

```typescript
// app/api/workflows/return-reminder/route.ts
import { serve } from "@upstash/workflow/nextjs";

export const { POST } = serve<{ borrowRecordId: string }>(
  async (context) => {
    const { borrowRecordId } = context.requestPayload;

    // Step 1: Wait until 3 days before the due date
    const borrowRecord = await context.run("fetch-record", async () => {
      return db.query.borrowRecords.findFirst({
        where: eq(borrowRecords.id, borrowRecordId),
        with: { user: true, book: true },
      });
    });

    if (!borrowRecord || borrowRecord.borrowStatus !== "BORROWED") {
      return; // Already returned or not found — nothing to do
    }

    const reminderDate = subDays(new Date(borrowRecord.dueDate), 3);
    await context.sleep(
      "wait-until-reminder",
      Math.max(0, differenceInSeconds(reminderDate, new Date())),
    );

    // Step 2: Check record is still active before sending
    const currentRecord = await context.run("check-still-borrowed", async () => {
      return db.query.borrowRecords.findFirst({
        where: and(
          eq(borrowRecords.id, borrowRecordId),
          eq(borrowRecords.borrowStatus, "BORROWED"),
        ),
        with: { user: true, book: true },
      });
    });

    if (!currentRecord) {
      return; // Book already returned — skip reminder
    }

    // Step 3: Send the reminder email
    await context.run("send-reminder-email", async () => {
      await sendEmail(config.env.emailjs.returnReminderTemplateId, {
        user_name:  currentRecord.user.fullName,
        user_email: currentRecord.user.email,
        book_title: currentRecord.book.title,
        due_date:   format(new Date(currentRecord.dueDate), "dd/MM/yyyy"),
      });
    });
  },
);
```

**Key behaviors:**

- `context.sleep()` pauses the workflow without holding a server connection — QStash resumes it at the right time
- The record is checked again just before sending to avoid reminders for already-returned books
- If the server restarts between steps, QStash re-delivers and the workflow resumes from the last completed step

---

## Template Management

### Creating Templates in EmailJS

1. Sign in to the [EmailJS dashboard](https://dashboard.emailjs.com)
2. Navigate to **Email Templates → Create New Template**
3. Design the HTML template using `{{variable_name}}` placeholders
4. Note the template ID and add it to your environment variables
5. Send a test email using the dashboard's test feature before deploying

### Common Template Variables

```typescript
interface BaseEmailParams {
  user_name:  string;
  user_email: string;
}

interface ApprovalEmailParams extends BaseEmailParams {
  library_url: string;
}

interface BorrowEmailParams extends BaseEmailParams {
  book_title:  string;
  book_author: string;
  borrow_date: string;
  due_date:    string;
}

interface ReminderEmailParams extends BaseEmailParams {
  book_title: string;
  due_date:   string;
}
```

---

## Error Handling

Email sending failures are caught at the call site and logged but do not affect the primary database operation:

```typescript
void sendEmail(templateId, params).catch((error) => {
  console.error("Email notification failed:", { templateId, error });
  // Primary operation (approve, reject, etc.) already succeeded
});
```

Workflow steps that throw are automatically retried by QStash according to the retry policy configured in the Upstash dashboard (default: 3 retries with exponential backoff).

> **Verification Required:** The exact QStash retry policy (max retries, backoff) is configured per workflow in the Upstash dashboard. Consult your Upstash project settings to confirm the active policy.

---

## Security Considerations

- EmailJS `privateKey` (`accessToken`) is used server-side only and never exposed to the client
- Email templates contain no sensitive data beyond user name, email, and book details
- Workflow payloads contain only record IDs — no PII is sent through QStash

---

## Testing and Development

To test email sending locally, set all `EMAILJS_*` environment variables in `.env.local` with real EmailJS credentials, or mock the `sendEmail` function in your test setup. In the integration test suite, `sendEmail` is mocked via the `vi.mock` factory in `tests/integration/setup.ts` so no real emails are sent during tests.

```typescript
// Verify email was triggered in integration tests
expect(mockSendEmail).toHaveBeenCalledWith(
  config.env.emailjs.approvalTemplateId,
  expect.objectContaining({ user_name: "Jane Doe" }),
);
```

---

## Related Files

- `lib/emailjs.ts` — `sendEmail()` utility
- `lib/workflow.ts` — Upstash Workflow client
- `lib/actions/auth.ts` — registration email trigger
- `lib/admin/actions/user.ts` — account approval/rejection email triggers
- `lib/admin/actions/receipt.ts` — borrow approval email + reminder workflow trigger
- `app/api/workflows/return-reminder/route.ts` — return reminder workflow handler
