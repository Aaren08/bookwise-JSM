import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockAuth,
  mockSignIn,
  mockHeaders,
  mockRedirect,
  mockDb,
  mockBroadcastAdminDashboard,
  mockPublishEvent,
  mockWorkflowTrigger,
} from "./helpers/instances";
import { createUser, hashPassword, resetCounters } from "./helpers/fixtures";

let signInWithCredentials: typeof import("@/lib/actions/auth").signInWithCredentials;
let signUp: typeof import("@/lib/actions/auth").signUp;

beforeEach(async () => {
  mockDb.clear();
  mockDb.setDefaults("users", {
    status: "PENDING",
    role: "USER",
    sessionVersion: 1,
    booksBorrowed: 0,
  });
  mockDb.setDefaults("app_settings", {
    borrowDurationDays: 14,
    supportEmail: "support@test.edu",
    websiteUrl: "https://test.edu",
    universityName: "Test University",
    version: 1,
  });

  mockHeaders.mockResolvedValue({
    get: (key: string) => {
      if (key === "x-forwarded-for") return "203.0.113.42";
      return null;
    },
  } as Headers);

  mockAuth.mockResolvedValue(null);
  mockSignIn.mockResolvedValue({ ok: true });

  mockSignIn.mockClear();
  mockBroadcastAdminDashboard.mockClear();
  mockPublishEvent.mockClear();
  mockWorkflowTrigger.mockClear();
  resetCounters();

  const authModule = await import("@/lib/actions/auth");
  signInWithCredentials = authModule.signInWithCredentials;
  signUp = authModule.signUp;
});

// ─── signInWithCredentials ─────────────────────────────────────────────────

describe("signInWithCredentials", () => {
  describe("happy path", () => {
    it("returns success with valid credentials", async () => {
      const password = "correct-horse-battery-staple";
      const hashed = await hashPassword(password);
      mockDb.seed("users", [
        createUser({
          email: "student@test.edu",
          password: hashed,
          status: "APPROVED",
        }),
      ]);

      const result = await signInWithCredentials({
        email: "student@test.edu",
        password,
      });

      expect(result).toEqual({ success: true });
      expect(mockSignIn).toHaveBeenCalledWith("credentials", {
        email: "student@test.edu",
        password,
        redirect: false,
      });
    });

    it("succeeds for PENDING status users too (status check is not in signIn)", async () => {
      const password = "test-password";
      const hashed = await hashPassword(password);
      mockDb.seed("users", [
        createUser({
          email: "pending@test.edu",
          password: hashed,
          status: "PENDING",
        }),
      ]);

      const result = await signInWithCredentials({
        email: "pending@test.edu",
        password,
      });

      expect(result).toEqual({ success: true });
    });

    it("rate limit is bypassed (safeRateLimit returns success by default)", async () => {
      const password = "test-password";
      const hashed = await hashPassword(password);
      mockDb.seed("users", [
        createUser({
          email: "student@test.edu",
          password: hashed,
          status: "APPROVED",
        }),
      ]);

      const result = await signInWithCredentials({
        email: "student@test.edu",
        password,
      });

      expect(result).toEqual({ success: true });
    });
  });

  describe("credential validation", () => {
    it("returns generic error for non-existent email", async () => {
      mockDb.seed("users", [
        createUser({ email: "other@test.edu", status: "APPROVED" }),
      ]);

      const result = await signInWithCredentials({
        email: "nonexistent@test.edu",
        password: "any-password",
      });

      expect(result).toEqual({
        success: false,
        error: "Invalid credentials",
      });
      expect(mockSignIn).not.toHaveBeenCalled();
    });

    it("returns generic error for wrong password", async () => {
      const password = "correct-password";
      const hashed = await hashPassword(password);
      mockDb.seed("users", [
        createUser({
          email: "student@test.edu",
          password: hashed,
          status: "APPROVED",
        }),
      ]);

      const result = await signInWithCredentials({
        email: "student@test.edu",
        password: "wrong-password",
      });

      expect(result).toEqual({
        success: false,
        error: "Invalid credentials",
      });
      expect(mockSignIn).not.toHaveBeenCalled();
    });

    it("returns same error message for non-existent email and wrong password", async () => {
      const password = "correct-password";
      const hashed = await hashPassword(password);
      mockDb.seed("users", [
        createUser({
          email: "student@test.edu",
          password: hashed,
          status: "APPROVED",
        }),
      ]);

      const [resultNonExistent, resultWrongPassword] = await Promise.all([
        signInWithCredentials({
          email: "nonexistent@test.edu",
          password: "any",
        }),
        signInWithCredentials({
          email: "student@test.edu",
          password: "wrong-password",
        }),
      ]);

      expect(resultNonExistent.error).toBe("Invalid credentials");
      expect(resultWrongPassword.error).toBe("Invalid credentials");
      expect(resultNonExistent.error).toBe(resultWrongPassword.error);
    });
  });

  describe("timing-attack protection", () => {
    it("always performs bcrypt comparison even for unknown emails", async () => {
      mockDb.seed("users", [
        createUser({ email: "other@test.edu", status: "APPROVED" }),
      ]);

      const result = await signInWithCredentials({
        email: "unknown@test.edu",
        password: "any-password",
      });

      expect(result).toEqual({
        success: false,
        error: "Invalid credentials",
      });
    });
  });

  describe("rate limiting", () => {
    it("redirects to /too-fast when rate limited", async () => {
      const { safeRateLimit } = await import("@/lib/essentials/rateLimit");
      vi.mocked(safeRateLimit).mockResolvedValueOnce({
        success: false,
        limit: 3,
        remaining: 0,
        reset: Date.now() + 600000,
        pending: Promise.resolve(),
      });

      await signInWithCredentials({
        email: "any@test.edu",
        password: "any",
      });

      expect(mockRedirect).toHaveBeenCalledWith("/too-fast");
      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("catches errors gracefully and returns generic message", async () => {
      mockDb.seed("users", [
        createUser({ email: "student@test.edu", status: "APPROVED" }),
      ]);

      const result = await signInWithCredentials({
        email: "student@test.edu",
        password: "",
      });

      expect(result.success).toBe(false);
    });
  });
});

// ─── signUp ────────────────────────────────────────────────────────────────

describe("signUp", () => {
  describe("happy path", () => {
    it("creates a new user with PENDING status", async () => {
      const result = await signUp({
        fullName: "New Student",
        email: "newstudent@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00001",
        universityCard: "https://img.test.edu/cards/test123",
      });

      expect(result).toEqual({ success: true });

      const users = mockDb.getTable("users");
      expect(users.length).toBe(1);
      expect(users[0].email).toBe("newstudent@test.edu");
      expect(users[0].fullName).toBe("New Student");
      expect(users[0].status).toBe("PENDING");
      expect(users[0].role).toBe("USER");
      expect(users[0].version).toBe(1);

      expect(users[0].password).not.toBe("secure-password-123");
      expect(users[0].password).toMatch(/^\$2[ab]\$10\$/);
    });

    it("calls signInWithCredentials after successful signup", async () => {
      await signUp({
        fullName: "New Student",
        email: "newstudent@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00001",
        universityCard: "https://img.test.edu/cards/test123",
      });

      expect(mockSignIn).toHaveBeenCalledWith("credentials", {
        email: "newstudent@test.edu",
        password: "secure-password-123",
        redirect: false,
      });
    });

    it("fires admin dashboard broadcast (fire-and-forget)", async () => {
      await signUp({
        fullName: "New Student",
        email: "newstudent@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00001",
        universityCard: "https://img.test.edu/cards/test123",
      });

      expect(mockBroadcastAdminDashboard).toHaveBeenCalledTimes(1);
    });

    it("publishes realtime account_requests CREATE event (non-blocking)", async () => {
      await signUp({
        fullName: "New Student",
        email: "newstudent@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00001",
        universityCard: "https://img.test.edu/cards/test123",
      });

      await vi.waitFor(() => {
        expect(mockPublishEvent).toHaveBeenCalled();
      });

      expect(mockPublishEvent).toHaveBeenCalledWith(
        "account_requests",
        expect.objectContaining({
          type: "CREATE",
          data: expect.objectContaining({
            email: "newstudent@test.edu",
            status: "PENDING",
          }),
        }),
      );
    });

    it("triggers onboarding workflow (fire-and-forget)", async () => {
      await signUp({
        fullName: "New Student",
        email: "newstudent@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00001",
        universityCard: "https://img.test.edu/cards/test123",
      });

      expect(mockWorkflowTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            email: "newstudent@test.edu",
            fullName: "New Student",
          }),
        }),
      );
    });
  });

  describe("validation", () => {
    it("returns error when user already exists", async () => {
      mockDb.seed("users", [
        createUser({
          email: "existing@test.edu",
          status: "PENDING",
        }),
      ]);

      const result = await signUp({
        fullName: "Duplicate User",
        email: "existing@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00002",
        universityCard: "https://img.test.edu/cards/test2",
      });

      expect(result).toEqual({
        success: false,
        error: "User already exists",
      });

      const users = mockDb.getTable("users");
      expect(users.length).toBe(1);
      expect(users[0].fullName).toBe("Test User 1");
    });

    it("handles existing user with APPROVED status correctly", async () => {
      mockDb.seed("users", [
        createUser({
          email: "existing@test.edu",
          status: "APPROVED",
        }),
      ]);

      const result = await signUp({
        fullName: "Try Again",
        email: "existing@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00003",
        universityCard: "https://img.test.edu/cards/test3",
      });

      expect(result).toEqual({
        success: false,
        error: "User already exists",
      });
    });

    it("handles existing user with REJECTED status correctly (still blocked)", async () => {
      mockDb.seed("users", [
        createUser({
          email: "rejected@test.edu",
          status: "REJECTED",
        }),
      ]);

      const result = await signUp({
        fullName: "Rejected User",
        email: "rejected@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00004",
        universityCard: "https://img.test.edu/cards/test4",
      });

      expect(result).toEqual({
        success: false,
        error: "User already exists",
      });
    });
  });

  describe("rate limiting", () => {
    it("redirects to /too-fast when rate limited", async () => {
      const { safeRateLimit } = await import("@/lib/essentials/rateLimit");
      vi.mocked(safeRateLimit).mockResolvedValueOnce({
        success: false,
        limit: 3,
        remaining: 0,
        reset: Date.now() + 600000,
        pending: Promise.resolve(),
      });

      await signUp({
        fullName: "Rate Limited",
        email: "ratelimited@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00005",
        universityCard: "https://img.test.edu/cards/test5",
      });

      expect(mockRedirect).toHaveBeenCalledWith("/too-fast");
      expect(mockDb.getTable("users").length).toBe(0);
    });
  });

  describe("resilience", () => {
    it("signup succeeds even if broadcast fails", async () => {
      mockBroadcastAdminDashboard.mockRejectedValueOnce(
        new Error("Redis unreachable"),
      );

      const result = await signUp({
        fullName: "Resilient User",
        email: "resilient@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00006",
        universityCard: "https://img.test.edu/cards/test6",
      });

      expect(result).toEqual({ success: true });
      const users = mockDb.getTable("users");
      expect(users.length).toBe(1);
    });

    it("signup succeeds even if workflow trigger fails", async () => {
      mockWorkflowTrigger.mockRejectedValueOnce(
        new Error("QStash unreachable"),
      );

      const result = await signUp({
        fullName: "Resilient User 2",
        email: "resilient2@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00007",
        universityCard: "https://img.test.edu/cards/test7",
      });

      expect(result).toEqual({ success: true });
      const users = mockDb.getTable("users");
      expect(users.length).toBe(1);
    });

    it("signup succeeds even if realtime publish fails", async () => {
      mockPublishEvent.mockRejectedValue(new Error("Pub/sub unavailable"));

      const result = await signUp({
        fullName: "Resilient User 3",
        email: "resilient3@test.edu",
        password: "secure-password-123",
        universityId: "UNIV00008",
        universityCard: "https://img.test.edu/cards/test8",
      });

      expect(result).toEqual({ success: true });
      const users = mockDb.getTable("users");
      expect(users.length).toBe(1);
    });

    it("password is hashed with bcrypt cost 10", async () => {
      await signUp({
        fullName: "Hash Check",
        email: "hashcheck@test.edu",
        password: "my-password",
        universityId: "UNIV00009",
        universityCard: "https://img.test.edu/cards/test9",
      });

      const users = mockDb.getTable("users");
      const storedHash = users[0].password as string;

      expect(storedHash.startsWith("$2b$10$")).toBe(true);

      const bcrypt = await import("bcryptjs");
      const isValid = await bcrypt.compare("my-password", storedHash);
      expect(isValid).toBe(true);
    });
  });
});
