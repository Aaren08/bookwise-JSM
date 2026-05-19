import { test as base, expect, Page } from "@playwright/test";
import { db } from "../../../../database/drizzle";
import { borrowRecords, appSettings } from "../../../../database/schema";
import { eq } from "drizzle-orm";
import dayjs from "dayjs";
import {
  signIn,
  ensureUserExists,
  ensureAdminExists,
  seedTestBook,
  cleanupTestBook,
  cleanupBorrowRecord,
  waitForAvailabilityToDecrease,
  waitForAvailabilityToReturn,
  getExpectedDueDate,
  findBorrowRecordRow,
  TEST_USER,
  TEST_ADMIN,
} from "../../utils/borrowing";

// ---------------------------------------------------------------------------
// Fixture extension — multi-actor simulation with separate contexts
// ---------------------------------------------------------------------------

type BorrowingFixtures = {
  userPage: Page;
  adminPage: Page;
};

const test = base.extend<BorrowingFixtures>({
  userPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  adminPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a receipt ID from the open receipt modal.
 */
async function getReceiptIdFromModal(page: Page): Promise<string> {
  const text = await page.getByText(/^#/).first().textContent();
  return text?.replace("#", "").trim() ?? "";
}

/**
 * Wait for the admin borrow table row to show a given status in the combobox.
 * Used to verify realtime SSE propagation after status transitions.
 */
async function waitForRowStatus(
  page: Page,
  bookTitle: string,
  expectedStatus: string,
  timeout = 15000,
) {
  const row = findBorrowRecordRow(page, bookTitle);
  const combobox = row.getByRole("combobox");
  await expect(combobox).toContainText(expectedStatus, { timeout });
}

/**
 * Assert the receipt modal contains all expected fields.
 */
async function assertReceiptModalContents(
  page: Page,
  {
    bookTitle,
    borrowDateFormatted,
    dueDateFormatted,
    receiptId,
  }: {
    bookTitle: string;
    borrowDateFormatted: string;
    dueDateFormatted: string;
    receiptId?: string;
  },
) {
  await expect(page.getByText("Borrow Receipt")).toBeVisible();
  await expect(page.getByText("Receipt ID:")).toBeVisible();
  if (receiptId) {
    await expect(page.getByText(`#${receiptId}`)).toBeVisible();
  }

  // The title in the receipt uses a <span>, while the table row uses a <p>.
  // We filter by 'span' to resolve the strict mode violation without needing a 'dialog' container.
  await expect(
    page.locator("span").filter({ hasText: bookTitle }),
  ).toBeVisible();

  // The label and value are split into separate spans, making the parent's textContent "Borrowed On:19/05/2026" (no space).
  // Using .toContainText on the row container reliably matches both parts.
  await expect(
    page.locator(".card-info-row").filter({ hasText: "Borrowed On:" }),
  ).toContainText(borrowDateFormatted);

  await expect(
    page.locator(".card-info-row").filter({ hasText: "Due Date:" }),
  ).toContainText(dueDateFormatted);
}

/**
 * Attach console error + request failure listeners for diagnostics.
 */
function addNetworkListeners(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;

    const text = msg.text();

    // Browser-level resource messages are noisy and lack the URL.
    // Track failed HTTP responses separately instead.
    if (text.includes("Failed to load resource")) return;

    errors.push(`[CONSOLE] ${text}`);
  });

  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "unknown";
    const url = req.url();

    const expectedAbort =
      failure === "net::ERR_ABORTED" &&
      (url.includes("/api/book/stream") ||
        url.includes("/_next/") ||
        url.includes("_rsc=") ||
        url.endsWith("/sign-in"));

    if (!expectedAbort) {
      errors.push(`[NETWORK] ${url} (${failure})`);
    }
  });

  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();

    if (status >= 400 && !url.includes("/favicon")) {
      errors.push(`[HTTP ${status}] ${url}`);
    }
  });

  return errors;
}

const SSE_TIMEOUT = 25000;

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe("Book Borrowing Lifecycle", () => {
  test.setTimeout(120000);

  let bookId: string;
  let bookTitle: string;
  let totalCopies: number;

  test.beforeAll(async () => {
    await ensureUserExists();
    await ensureAdminExists();

    const book = await seedTestBook();
    bookId = book.id;
    bookTitle = book.title;
    totalCopies = book.totalCopies;
  });

  test.afterAll(async () => {
    // Clean up borrow records associated with the test book
    try {
      const records = await db
        .select({ id: borrowRecords.id })
        .from(borrowRecords)
        .where(eq(borrowRecords.bookId, bookId))
        .limit(10);
      for (const record of records) {
        await cleanupBorrowRecord(record.id);
      }
    } catch {
      // best-effort cleanup
    }

    await cleanupTestBook().catch(() => {});
  });

  test("Complete borrowing lifecycle: borrow → approve → receipt → return", async ({
    userPage,
    adminPage,
  }) => {
    const userErrors = addNetworkListeners(userPage);
    const adminErrors = addNetworkListeners(adminPage);
    const initialAvailable = totalCopies;

    // ── 1. USER: Sign in and view book detail page ────────────────────────────
    await test.step("1. User signs in and views book detail page", async () => {
      await signIn(userPage, TEST_USER.email, TEST_USER.password);
      await userPage.goto(`/books/${bookId}`);

      await expect(
        userPage.getByRole("heading", { name: bookTitle }),
      ).toBeVisible();
      await expect(
        userPage.getByText(`Total Books:${totalCopies}`),
      ).toBeVisible();
      await expect(
        userPage.getByText(`Available Books:${initialAvailable}`),
      ).toBeVisible();
    });

    // ── 2. USER: Click "Borrow Book Request" ──────────────────────────────────
    await test.step("2. User clicks Borrow Book Request", async () => {
      await userPage
        .getByRole("button", { name: "Borrow Book Request" })
        .click();

      await expect(userPage.getByText("Book request is forwarded")).toBeVisible(
        {
          timeout: 10000,
        },
      );
    });

    // ── 3. USER: Verify real-time availability decrease via SSE ───────────────
    await test.step("3. Available copies decrease in real-time (SSE)", async () => {
      await waitForAvailabilityToDecrease(
        userPage,
        initialAvailable,
        SSE_TIMEOUT,
      );

      // Confirm no page reload — URL is still the book detail page
      expect(userPage.url()).toContain(`/books/${bookId}`);

      // Borrow button returns to enabled state after request completes
      await expect(
        userPage.getByRole("button", { name: "Borrow Book Request" }),
      ).toBeEnabled();
    });

    // ── 4. ADMIN: Sign in and see pending request ─────────────────────────────
    let receiptGeneratedAt: Date;
    let receiptId: string;

    await test.step("4. Admin sees PENDING request in borrow records", async () => {
      await signIn(adminPage, TEST_ADMIN.email, TEST_ADMIN.password);
      await adminPage.goto("/admin/borrow-records");

      const row = findBorrowRecordRow(adminPage, bookTitle);
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row.getByRole("combobox")).toContainText("Pending");

      // Verify the Generate button is available for PENDING records
      await expect(row.getByRole("button", { name: "Generate" })).toBeEnabled();
    });

    // ── 5. ADMIN: Generate receipt (approves PENDING → BORROWED) ──────────────
    await test.step("5. Admin generates receipt (approves request)", async () => {
      const row = findBorrowRecordRow(adminPage, bookTitle);
      receiptGeneratedAt = new Date();

      await row.getByRole("button", { name: "Generate" }).click();

      await expect(adminPage.getByText("Borrow Receipt")).toBeVisible({
        timeout: 10000,
      });

      receiptId = await getReceiptIdFromModal(adminPage);

      // Fetch dynamic borrow duration configuration from database
      const [settings] = await db
        .select({ borrowDurationDays: appSettings.borrowDurationDays })
        .from(appSettings)
        .where(eq(appSettings.id, true))
        .limit(1);
      const borrowDurationDays = settings?.borrowDurationDays ?? 14;

      const borrowDateFormatted =
        dayjs(receiptGeneratedAt).format("DD/MM/YYYY");
      const dueDateFormatted = getExpectedDueDate(
        receiptGeneratedAt,
        borrowDurationDays,
      );

      await assertReceiptModalContents(adminPage, {
        bookTitle,
        borrowDateFormatted,
        dueDateFormatted,
        receiptId,
      });
    });

    // ── 6. ADMIN: Close receipt modal ─────────────────────────────────────────
    await test.step("6. Admin closes receipt modal", async () => {
      await adminPage.locator(".modal-close-btn").click();
      await expect(adminPage.getByText("Borrow Receipt")).not.toBeVisible();
    });

    // ── 7. ADMIN: Wait for realtime BORROWED status ───────────────────────────
    await test.step("7. Realtime status propagates to BORROWED", async () => {
      await waitForRowStatus(adminPage, bookTitle, "Borrowed", SSE_TIMEOUT);
    });

    // ── 8. USER: Profile shows BORROWED status ────────────────────────────────
    await test.step("8. User profile shows BORROWED status", async () => {
      await userPage.goto("/my-profile");
      await expect(userPage.getByText(/Borrowed on/)).toBeVisible({
        timeout: 10000,
      });
    });

    // ── 9. USER: Open receipt and download PDF ────────────────────────────────
    await test.step("9. User opens receipt and downloads PDF", async () => {
      const receiptButton = userPage
        .getByRole("button")
        .filter({ has: userPage.locator('[alt="receipt"]') });
      await receiptButton.click();
      await expect(userPage.getByText("Borrow Receipt")).toBeVisible({
        timeout: 5000,
      });

      // Accessibility: verify modal heading hierarchy
      await expect(
        userPage.getByRole("heading", { name: "Borrow Receipt" }),
      ).toBeVisible();
      await expect(
        userPage.getByRole("heading", { name: "Book Details:" }),
      ).toBeVisible();

      // Set up download listener and trigger PDF download
      const downloadPromise = userPage.waitForEvent("download", {
        timeout: 15000,
      });
      await userPage.getByTitle("Download as PDF").click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toMatch(/receipt-.+\.pdf/);

      await userPage.locator(".modal-close-btn").click();
      await expect(userPage.getByText("Borrow Receipt")).not.toBeVisible();
    });

    // ── 10. ADMIN: Mark book as returned ──────────────────────────────────────
    await test.step("10. Admin marks book as returned", async () => {
      const row = findBorrowRecordRow(adminPage, bookTitle);
      await row.getByRole("combobox").click();
      await adminPage.getByRole("option", { name: "Returned" }).click();

      // Asserting application state is more robust than asserting transient toast notifications.
      await expect(row.getByRole("combobox")).toContainText("Returned", {
        timeout: 10000,
      });
    });

    // ── 11. Wait for realtime RETURNED status ─────────────────────────────────
    await test.step("11. Realtime status propagates to RETURNED", async () => {
      await waitForRowStatus(adminPage, bookTitle, "Returned", SSE_TIMEOUT);
    });

    async function waitForBorrowRecordStatus(
      bookId: string,
      status: "RETURNED" | "BORROWED",
      timeout = 25000,
    ) {
      await expect
        .poll(
          async () => {
            const [record] = await db
              .select({
                status: borrowRecords.borrowStatus,
                returnDate: borrowRecords.returnDate,
              })
              .from(borrowRecords)
              .where(eq(borrowRecords.bookId, bookId))
              .limit(1);

            return record?.status;
          },
          { timeout },
        )
        .toBe(status);
    }

    // ── 12. USER: Profile shows RETURNED status ──────────────────────────────
    await test.step("12. User profile shows RETURNED status", async () => {
      await waitForBorrowRecordStatus(bookId, "RETURNED", SSE_TIMEOUT);

      await userPage.goto("/my-profile");

      const returnedBook = userPage
        .getByRole("listitem")
        .filter({ hasText: bookTitle });

      await expect(returnedBook.getByText(/Returned on/)).toBeVisible({
        timeout: 10000,
      });
    });

    // ── 13. USER: Verify availability restores via SSE ────────────────────────
    await test.step("13. Available copies restore to original (SSE)", async () => {
      await userPage.goto(`/books/${bookId}`);
      await waitForAvailabilityToReturn(
        userPage,
        initialAvailable,
        SSE_TIMEOUT,
      );
    });

    // ── 14. Verify no critical console/network errors ─────────────────────────
    await test.step("14. No critical console or network errors", async () => {
      const allErrors = [...userErrors, ...adminErrors];
      const criticalErrors = allErrors.filter(
        (e) =>
          !e.includes("EventSource") &&
          !e.includes("heartbeat") &&
          !e.includes("AbortError") &&
          !e.includes("favicon"),
      );
      expect(criticalErrors).toHaveLength(0);
    });

    // ── 15. Verify modal close button is accessible (ARIA) ─────────────────────
    await test.step("15. Disabled button semantics verified", async () => {
      // After the return flow, the admin Generate button should be disabled
      // (status is no longer PENDING so the button is non-interactive).
      // This validates that disabled semantics are preserved.
      const row = findBorrowRecordRow(adminPage, bookTitle);
      const generateBtn = row.getByRole("button", { name: "Generate" });
      await expect(generateBtn).toBeDisabled();
    });
  });
});
