import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatBorrowDuration,
  getDueDateFromBorrowDuration,
  DEFAULT_SYSTEM_CONFIG,
} from "@/lib/global/essentials/system-config";

const REFERENCE_DATE = "2026-05-24T12:00:00.000Z";

describe("formatBorrowDuration", () => {
  describe("pluralization", () => {
    it('returns "X Days" for values > 1', () => {
      expect(formatBorrowDuration(2)).toBe("2 Days");
      expect(formatBorrowDuration(14)).toBe("14 Days");
      expect(formatBorrowDuration(365)).toBe("365 Days");
    });

    it('returns "1 Day" for value of 1', () => {
      expect(formatBorrowDuration(1)).toBe("1 Day");
    });
  });

  describe("edge cases", () => {
    it('returns "0 Days" for zero', () => {
      expect(formatBorrowDuration(0)).toBe("0 Days");
    });

    it("handles negative values", () => {
      expect(formatBorrowDuration(-1)).toBe("-1 Days");
      expect(formatBorrowDuration(-5)).toBe("-5 Days");
    });

    it("handles non-integer values", () => {
      expect(formatBorrowDuration(2.5)).toBe("2.5 Days");
    });
  });

  describe("DEFAULT_SYSTEM_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_SYSTEM_CONFIG.instituteName).toBe("BookWise");
      expect(DEFAULT_SYSTEM_CONFIG.websiteUrl).toBe("");
      expect(DEFAULT_SYSTEM_CONFIG.supportEmail).toBe("");
      expect(DEFAULT_SYSTEM_CONFIG.borrowDurationDays).toBe(14);
    });
  });
});

describe("getDueDateFromBorrowDuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(REFERENCE_DATE));
  });

  it("returns a dayjs object exactly N days in the future", () => {
    const result = getDueDateFromBorrowDuration(14);

    expect(result.format("YYYY-MM-DD")).toBe("2026-06-07");
  });

  it("returns the same day for 0 days", () => {
    const result = getDueDateFromBorrowDuration(0);

    expect(result.format("YYYY-MM-DD")).toBe("2026-05-24");
  });

  it("handles 1 day (next day)", () => {
    const result = getDueDateFromBorrowDuration(1);

    expect(result.format("YYYY-MM-DD")).toBe("2026-05-25");
  });

  it("handles the maximum constraint of 365 days", () => {
    const result = getDueDateFromBorrowDuration(365);

    expect(result.format("YYYY-MM-DD")).toBe("2027-05-24");
  });

  it("handles negative days (past dates)", () => {
    const result = getDueDateFromBorrowDuration(-30);

    expect(result.format("YYYY-MM-DD")).toBe("2026-04-24");
  });

  it("handles month boundaries", () => {
    vi.setSystemTime(new Date("2026-01-31T12:00:00.000Z"));
    const result = getDueDateFromBorrowDuration(1);

    expect(result.format("YYYY-MM-DD")).toBe("2026-02-01");
  });

  it("handles leap year February correctly", () => {
    vi.setSystemTime(new Date("2024-01-31T12:00:00.000Z"));
    const result = getDueDateFromBorrowDuration(30);

    expect(result.format("YYYY-MM-DD")).toBe("2024-03-01");
  });

  it("does not mutate between calls (immutability)", () => {
    const first = getDueDateFromBorrowDuration(14);
    const second = getDueDateFromBorrowDuration(14);

    expect(first.format("YYYY-MM-DD")).toBe(second.format("YYYY-MM-DD"));
  });

  it("returns different results for different inputs", () => {
    const result1 = getDueDateFromBorrowDuration(7);
    const result2 = getDueDateFromBorrowDuration(14);

    expect(result1.isBefore(result2)).toBe(true);
  });
});
