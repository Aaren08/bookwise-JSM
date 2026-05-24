import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateBorrowStatus,
  getBorrowStatusColor,
  getBorrowStatusText,
} from "@/lib/essentials/returnPolicy";

const REFERENCE_DATE = "2026-05-24T12:00:00.000Z";

describe("calculateBorrowStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(REFERENCE_DATE));
  });

  describe("happy paths", () => {
    it("returns isOverdue=false when due date is in the future", () => {
      const result = calculateBorrowStatus("2026-05-20", "2026-06-03");

      expect(result.isOverdue).toBe(false);
      expect(result.daysLeft).toBeGreaterThan(0);
    });

    it("returns daysLeft=0 and positive hoursLeft when due is today", () => {
      const result = calculateBorrowStatus("2026-05-20", "2026-05-24");

      expect(result.isOverdue).toBe(false);
      expect(result.daysLeft).toBe(0);
      expect(result.hoursLeft).toBeGreaterThan(0);
    });
  });

  describe("overdue behavior", () => {
    it("marks as overdue with non-negative daysLeft when due date has passed", () => {
      const result = calculateBorrowStatus("2026-05-01", "2026-05-10");

      expect(result.isOverdue).toBe(true);
      expect(result.daysLeft).toBeGreaterThanOrEqual(0);
      expect(result.hoursLeft).toBeGreaterThanOrEqual(0);
    });
  });

  describe("borrowDate === dueDate", () => {
    it("handles same-day borrow and due", () => {
      const date = "2026-05-24";
      const result = calculateBorrowStatus(date, date);

      expect(result.isOverdue).toBe(false);
      expect(result.daysLeft).toBe(0);
      expect(result.borrowDate).toBe(result.dueDate);
    });
  });

  describe("edge cases", () => {
    it("marks overdue when due date was yesterday (endOf day applies)", () => {
      vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
      const result = calculateBorrowStatus("2026-05-20", "2026-05-24");

      expect(result.isOverdue).toBe(true);
    });

    it("handles due date one millisecond past midnight (barely overdue)", () => {
      vi.setSystemTime(new Date("2026-05-25T00:00:00.001Z"));
      const result = calculateBorrowStatus("2026-05-20", "2026-05-24");

      expect(result.isOverdue).toBe(true);
    });

    it("handles extremely far future dates (365+ days)", () => {
      const result = calculateBorrowStatus("2026-01-01", "2027-06-01");

      expect(result.isOverdue).toBe(false);
      expect(result.daysLeft).toBeGreaterThan(365);
    });

    it("handles leap year dates (Feb 29)", () => {
      vi.setSystemTime(new Date("2024-02-28T12:00:00.000Z"));
      const result = calculateBorrowStatus("2024-02-01", "2024-03-01");

      expect(result.isOverdue).toBe(false);
      expect(result.daysLeft).toBeGreaterThan(0);
    });

    it("handles DST spring-forward transition", () => {
      vi.setSystemTime(new Date("2026-03-08T12:00:00.000Z"));
      const result = calculateBorrowStatus("2026-03-01", "2026-03-15");

      expect(result.isOverdue).toBe(false);
    });

    it("handles DST fall-back transition", () => {
      vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
      const result = calculateBorrowStatus("2026-10-25", "2026-11-08");

      expect(result.isOverdue).toBe(false);
    });

    it("accepts Date objects and string inputs interchangeably", () => {
      const result = calculateBorrowStatus(
        new Date("2026-05-20"),
        "2026-06-03",
      );

      expect(result.isOverdue).toBe(false);
      expect(result.daysLeft).toBeGreaterThan(0);
    });
  });

  describe("format invariants", () => {
    it("always returns MMM DD format for dates", () => {
      const result = calculateBorrowStatus("2026-05-01", "2026-06-15");

      expect(result.borrowDate).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
      expect(result.dueDate).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
    });

    it("returns non-negative daysLeft and hoursLeft even when overdue", () => {
      const result = calculateBorrowStatus("2026-01-01", "2026-01-15");

      expect(result.daysLeft).toBeGreaterThanOrEqual(0);
      expect(result.hoursLeft).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("getBorrowStatusColor", () => {
  it("returns red (#ef3a4b) when overdue", () => {
    expect(getBorrowStatusColor(true)).toBe("#ef3a4b");
  });

  it("returns beige (#e7c9a5) when not overdue", () => {
    expect(getBorrowStatusColor(false)).toBe("#e7c9a5");
  });
});

describe("getBorrowStatusText", () => {
  it('returns "Overdue Return" when isOverdue is true', () => {
    const status = {
      daysLeft: 5,
      hoursLeft: 120,
      isOverdue: true,
      borrowDate: "May 20",
      dueDate: "May 25",
    };
    expect(getBorrowStatusText(status)).toBe("Overdue Return");
  });

  it('returns "X hrs left to due" when daysLeft=0 and hoursLeft > 1', () => {
    const status = {
      daysLeft: 0,
      hoursLeft: 5,
      isOverdue: false,
      borrowDate: "May 20",
      dueDate: "May 24",
    };
    expect(getBorrowStatusText(status)).toBe("5 hrs left to due");
  });

  it('returns "1 hr left to due" when daysLeft=0 and hoursLeft=1', () => {
    const status = {
      daysLeft: 0,
      hoursLeft: 1,
      isOverdue: false,
      borrowDate: "May 23",
      dueDate: "May 24",
    };
    expect(getBorrowStatusText(status)).toBe("1 hr left to due");
  });

  it('returns "0 hrs left to due" when daysLeft=0 and hoursLeft=0', () => {
    const status = {
      daysLeft: 0,
      hoursLeft: 0,
      isOverdue: false,
      borrowDate: "May 24",
      dueDate: "May 24",
    };
    expect(getBorrowStatusText(status)).toBe("0 hrs left to due");
  });

  it('uses singular "day" when daysLeft=1', () => {
    const status = {
      daysLeft: 1,
      hoursLeft: 24,
      isOverdue: false,
      borrowDate: "May 23",
      dueDate: "May 25",
    };
    expect(getBorrowStatusText(status)).toBe("1 day left to due");
  });

  it('uses plural "days" when daysLeft > 1', () => {
    const status = {
      daysLeft: 7,
      hoursLeft: 168,
      isOverdue: false,
      borrowDate: "May 17",
      dueDate: "May 31",
    };
    expect(getBorrowStatusText(status)).toBe("7 days left to due");
  });

  it("handles large daysLeft value gracefully", () => {
    const status = {
      daysLeft: 365,
      hoursLeft: 8760,
      isOverdue: false,
      borrowDate: "May 24",
      dueDate: "May 24",
    };
    expect(getBorrowStatusText(status)).toBe("365 days left to due");
  });

  it("prioritizes overdue text over any daysLeft value", () => {
    const status = {
      daysLeft: 100,
      hoursLeft: 2400,
      isOverdue: true,
      borrowDate: "May 20",
      dueDate: "May 25",
    };
    expect(getBorrowStatusText(status)).toBe("Overdue Return");
  });
});
