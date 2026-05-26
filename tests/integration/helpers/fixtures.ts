/**
 * fixtures.ts — Factory functions for test data used across integration tests.
 *
 * Each factory produces complete, deterministic rows with sensible defaults.
 * Override any field via the optional parameter.
 */
import crypto from "node:crypto";

// ─── User Factories ────────────────────────────────────────────────────────

type UserSeed = {
  id?: string;
  fullName?: string;
  email?: string;
  password?: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  role?: "USER" | "ADMIN";
  universityId?: string;
  universityCard?: string;
  userAvatar?: string | null;
  userAvatarFileId?: string | null;
  sessionVersion?: number;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
  booksBorrowed?: number;
};

let userCounter = 0;

export const resetCounters = () => {
  userCounter = 0;
};

export const createUser = (overrides: UserSeed = {}) => {
  userCounter++;
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date();
  return {
    id,
    fullName: overrides.fullName ?? `Test User ${userCounter}`,
    email: overrides.email ?? `user${userCounter}@test.edu`,
    password:
      overrides.password ??
      "$2b$10$rBV2u1C4JZwF3HJfCqYGpO7K9H9FhZ8Hk8fQ6yN2vJ4xX1Y0Z3K4G",
    status: overrides.status ?? "PENDING",
    role: overrides.role ?? "USER",
    universityId: overrides.universityId ?? `UNIV${String(userCounter).padStart(5, "0")}`,
    universityCard: overrides.universityCard ?? `https://img.test.edu/cards/${id}`,
    userAvatar: overrides.userAvatar ?? null,
    userAvatarFileId: overrides.userAvatarFileId ?? null,
    sessionVersion: overrides.sessionVersion ?? 1,
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    booksBorrowed: overrides.booksBorrowed ?? 0,
  };
};

export const createPendingUser = (overrides: UserSeed = {}) =>
  createUser({ ...overrides, status: "PENDING" });

export const createApprovedUser = (overrides: UserSeed = {}) =>
  createUser({ ...overrides, status: "APPROVED" });

export const createRejectedUser = (overrides: UserSeed = {}) =>
  createUser({ ...overrides, status: "REJECTED" });

export const createAdmin = (overrides: UserSeed = {}) =>
  createApprovedUser({ ...overrides, role: "ADMIN" });

// ─── Book Factories ────────────────────────────────────────────────────────

type BookSeed = {
  id?: string;
  title?: string;
  author?: string;
  genre?: string;
  rating?: number;
  totalCopies?: number;
  borrowedCount?: number;
  reservedCount?: number;
  description?: string;
  coverColor?: string;
  coverUrl?: string;
  videoUrl?: string;
  summary?: string;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

let bookCounter = 0;

export const createBook = (overrides: BookSeed = {}) => {
  bookCounter++;
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date();
  const totalCopies = overrides.totalCopies ?? 5;
  const borrowedCount = overrides.borrowedCount ?? 0;
  const reservedCount = overrides.reservedCount ?? 0;
  return {
    id,
    title: overrides.title ?? `Test Book ${bookCounter}`,
    author: overrides.author ?? `Author ${bookCounter}`,
    genre: overrides.genre ?? "Fiction",
    rating: overrides.rating ?? 4.0,
    totalCopies,
    borrowedCount,
    reservedCount,
    availableCopies: totalCopies - borrowedCount - reservedCount,
    description: overrides.description ?? "A test book description.",
    coverColor: overrides.coverColor ?? "#FF5733",
    coverUrl: overrides.coverUrl ?? `https://img.test.edu/books/${id}`,
    videoUrl: overrides.videoUrl ?? `https://video.test.edu/books/${id}`,
    summary: overrides.summary ?? "Test summary.",
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
};

export const createAvailableBook = (overrides: BookSeed = {}) =>
  createBook({ totalCopies: 5, borrowedCount: 0, reservedCount: 0, ...overrides });

export const createFullyBorrowedBook = (overrides: BookSeed = {}) =>
  createBook({ totalCopies: 3, borrowedCount: 3, reservedCount: 0, ...overrides });

export const createFullyReservedBook = (overrides: BookSeed = {}) =>
  createBook({ totalCopies: 2, borrowedCount: 0, reservedCount: 2, ...overrides });

// ─── Borrow Record Factories ───────────────────────────────────────────────

type BorrowRecordSeed = {
  id?: string;
  userId?: string;
  bookId?: string;
  borrowDate?: Date;
  dueDate?: string;
  returnDate?: string | null;
  borrowStatus?: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED";
  reservedAt?: Date | null;
  isAdminCleared?: boolean;
  dismissed?: number;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

let borrowCounter = 0;

export const createBorrowRecord = (overrides: BorrowRecordSeed = {}) => {
  borrowCounter++;
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date();
  const dueDate = overrides.dueDate ?? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return {
    id,
    userId: overrides.userId ?? crypto.randomUUID(),
    bookId: overrides.bookId ?? crypto.randomUUID(),
    borrowDate: overrides.borrowDate ?? now,
    dueDate,
    returnDate: overrides.returnDate ?? null,
    borrowStatus: overrides.borrowStatus ?? "PENDING",
    reservedAt: overrides.reservedAt ?? (overrides.borrowStatus === "PENDING" ? now : null),
    isAdminCleared: overrides.isAdminCleared ?? false,
    dismissed: overrides.dismissed ?? 0,
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
};

export const createPendingBorrow = (overrides: BorrowRecordSeed = {}) =>
  createBorrowRecord({ ...overrides, borrowStatus: "PENDING" });

export const createBorrowedBorrow = (overrides: BorrowRecordSeed = {}) =>
  createBorrowRecord({ ...overrides, borrowStatus: "BORROWED" });

export const createReturnedBorrow = (overrides: BorrowRecordSeed = {}) =>
  createBorrowRecord({ ...overrides, borrowStatus: "RETURNED", returnDate: new Date().toISOString().slice(0, 10) });

export const createLateReturnBorrow = (overrides: BorrowRecordSeed = {}) =>
  createBorrowRecord({
    ...overrides,
    borrowStatus: "LATE_RETURN",
    returnDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  });

export const createRejectedBorrow = (overrides: BorrowRecordSeed = {}) =>
  createBorrowRecord({ ...overrides, borrowStatus: "REJECTED" });

// ─── App Settings Fixture ──────────────────────────────────────────────────

export const createAppSettings = (overrides: Record<string, unknown> = {}) => ({
  id: true,
  initializedAt: new Date(),
  setupCompleted: true,
  setupCompletedAt: new Date(),
  setupCompletedBy: null,
  borrowDurationDays: 14,
  supportEmail: "library@test.edu",
  websiteUrl: "https://library.test.edu",
  universityName: "Test University",
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─── Session Fixtures ──────────────────────────────────────────────────────

export const createAdminSession = (adminId?: string) => ({
  user: {
    id: adminId ?? crypto.randomUUID(),
    name: "Admin User",
    email: "admin@test.edu",
    role: "ADMIN",
    sessionVersion: 1,
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
});

export const createUserSession = (userId?: string) => ({
  user: {
    id: userId ?? crypto.randomUUID(),
    name: "Regular User",
    email: "user@test.edu",
    role: "USER",
    sessionVersion: 1,
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
});

export const createUnauthenticatedSession = () => null;

// ─── Rate Limit Fixtures ───────────────────────────────────────────────────

export const createRateLimitPass = () => ({
  success: true,
  limit: 100,
  remaining: 99,
  reset: Date.now() + 60000,
  pending: Promise.resolve(),
});

export const createRateLimitBlock = () => ({
  success: false,
  limit: 3,
  remaining: 0,
  reset: Date.now() + 600000,
  pending: Promise.resolve(),
});

// ─── Redis Lock Fixtures ───────────────────────────────────────────────────

export const createLockPayload = (overrides: Record<string, unknown> = {}) => ({
  entity: "borrow_requests",
  entityId: crypto.randomUUID(),
  adminId: crypto.randomUUID(),
  adminName: "Admin User",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  token: "test-lock-token",
  version: 1,
  ...overrides,
});

// ─── Dummy Hashes ──────────────────────────────────────────────────────────

/**
 * Valid bcrypt hash of 'dummy' with cost 10.
 * Used for timing-attack prevention in auth tests.
 */
export const DUMMY_HASH =
  "$2b$10$rBV2u1C4JZwF3HJfCqYGpO7K9H9FhZ8Hk8fQ6yN2vJ4xX1Y0Z3K4G";

/**
 * Create a real bcrypt hash for a password (used in signUp tests).
 */
export const hashPassword = async (password: string): Promise<string> => {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(password, 10);
};

// ─── Mock Request / Response ───────────────────────────────────────────────

export const createMockRequest = (
  body: unknown,
  options: { headers?: Record<string, string> } = {},
) => {
  const headers = new Headers({
    "content-type": "application/json",
    ...options.headers,
  });
  return new Request("http://localhost/api/book/requests", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

export const createMockAdminRequest = (
  body: unknown,
  params: { id: string },
  options: { headers?: Record<string, string> } = {},
) => {
  const headers = new Headers({
    "content-type": "application/json",
    ...options.headers,
  });
  return new Request(`http://localhost/api/book/requests/${params.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
};
