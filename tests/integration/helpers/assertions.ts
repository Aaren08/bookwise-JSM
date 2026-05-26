/**
 * assertions.ts — Reusable DB-state assertion helpers for integration tests.
 *
 * Wraps common patterns so tests read as plain-English specifications
 * rather than implementation detail.
 */
import { expect } from "vitest";
import { mockDb } from "./instances";

export function assertRowExists(
  tableName: string,
  id: string,
): Record<string, unknown> {
  const row = mockDb.getRow(tableName, id);
  expect(row).not.toBeNull();
  return row!;
}

export function assertRowNotExists(tableName: string, id: string) {
  expect(mockDb.getRow(tableName, id)).toBeNull();
}

export function assertVersionIncremented(
  tableName: string,
  id: string,
  oldVersion: number,
) {
  const row = assertRowExists(tableName, id);
  expect(row.version).toBe(oldVersion + 1);
}

export function assertVersionUnchanged(
  tableName: string,
  id: string,
  expectedVersion: number,
) {
  const row = assertRowExists(tableName, id);
  expect(row.version).toBe(expectedVersion);
}

export function assertBorrowStatus(recordId: string, expectedStatus: string) {
  const record = assertRowExists("borrow_records", recordId);
  expect(record.borrowStatus).toBe(expectedStatus);
}

export function assertBookCounts(
  bookId: string,
  expected: Partial<{
    borrowedCount: number;
    reservedCount: number;
    availableCopies: number;
  }>,
) {
  const book = assertRowExists("books", bookId);
  for (const [key, value] of Object.entries(expected)) {
    expect(book[key]).toBe(value);
  }
}

export function assertUserStatus(userId: string, expectedStatus: string) {
  const user = assertRowExists("users", userId);
  expect(user.status).toBe(expectedStatus);
}

export function assertUserRole(userId: string, expectedRole: string) {
  const user = assertRowExists("users", userId);
  expect(user.role).toBe(expectedRole);
}

export function assertQueryLogContains(
  type: "select" | "insert" | "update" | "delete" | "execute" | "transaction",
  table?: string,
) {
  const log = mockDb.getQueryLog();
  const found = log.some(
    (entry) => entry.type === type && (table ? entry.table === table : true),
  );
  expect(found).toBe(true);
}

export function assertQueryLogCount(expected: number) {
  expect(mockDb.getQueryLog().length).toBe(expected);
}
