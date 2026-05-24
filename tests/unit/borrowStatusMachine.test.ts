import { describe, it, expect } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/database/drizzle", () => ({
  db: {},
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/database/schema", () => ({
  borrowRecords: {},
  books: {},
  users: {},
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock(
  "@/lib/admin/realtime/broadcast/dashboardSocketServer",
  () => ({
    broadcastAdminDashboardUpdate: vi.fn(),
    broadcastBookAvailabilityUpdate: vi.fn(),
  }),
);

vi.mock(
  "@/lib/admin/realtime/concurrency/rowConcurrency",
  () => ({ publishEvent: vi.fn(), CONFLICT_ERROR_MESSAGE: "Conflict" }),
);

const { validateBorrowStatusTransition } = await import(
  "@/lib/admin/actions/borrow"
);

type BorrowStatus = "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN" | "REJECTED";

const ALL_STATUSES: BorrowStatus[] = [
  "PENDING",
  "BORROWED",
  "RETURNED",
  "LATE_RETURN",
  "REJECTED",
];

describe("validateBorrowStatusTransition", () => {
  describe("allowed transitions", () => {
    const allowed: [BorrowStatus, BorrowStatus][] = [
      ["PENDING", "BORROWED"],
      ["PENDING", "REJECTED"],
      ["BORROWED", "RETURNED"],
      ["BORROWED", "LATE_RETURN"],
    ];

    it.each(allowed)("allows %s → %s", async (current, next) => {
      await expect(validateBorrowStatusTransition(current, next)).resolves.toBe(
        true,
      );
    });
  });

  describe("forbidden transitions", () => {
    const forbidden: [BorrowStatus, BorrowStatus][] = [
      ["PENDING", "PENDING"],
      ["PENDING", "RETURNED"],
      ["PENDING", "LATE_RETURN"],
      ["BORROWED", "PENDING"],
      ["BORROWED", "BORROWED"],
      ["BORROWED", "REJECTED"],
      ["RETURNED", "PENDING"],
      ["RETURNED", "BORROWED"],
      ["RETURNED", "RETURNED"],
      ["RETURNED", "LATE_RETURN"],
      ["RETURNED", "REJECTED"],
      ["LATE_RETURN", "PENDING"],
      ["LATE_RETURN", "BORROWED"],
      ["LATE_RETURN", "RETURNED"],
      ["LATE_RETURN", "LATE_RETURN"],
      ["LATE_RETURN", "REJECTED"],
      ["REJECTED", "PENDING"],
      ["REJECTED", "BORROWED"],
      ["REJECTED", "RETURNED"],
      ["REJECTED", "LATE_RETURN"],
      ["REJECTED", "REJECTED"],
    ];

    it.each(forbidden)("rejects %s → %s", async (current, next) => {
      await expect(validateBorrowStatusTransition(current, next)).resolves.toBe(
        false,
      );
    });
  });

  describe("terminal states", () => {
    it.each(["RETURNED", "LATE_RETURN", "REJECTED"] as BorrowStatus[])(
      "prevents any transition from terminal state %s",
      async (terminal) => {
        for (const next of ALL_STATUSES) {
          await expect(
            validateBorrowStatusTransition(terminal, next),
          ).resolves.toBe(false);
        }
      },
    );
  });

  describe("transition matrix coverage (all pairs)", () => {
    it("validates all 25 possible transitions and finds exactly 4 allowed", async () => {
      const results = await Promise.all(
        ALL_STATUSES.flatMap((current) =>
          ALL_STATUSES.map(async (next) => ({
            current,
            next,
            allowed: await validateBorrowStatusTransition(current, next),
          })),
        ),
      );

      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBe(4);
    });
  });
});

describe("borrow status delta computation", () => {
  type DeltaResult = {
    reservedChange: number;
    borrowedChange: number;
  };

  const computeDeltas = (
    oldStatus: BorrowStatus,
    newStatus: BorrowStatus,
  ): DeltaResult => {
    let reservedChange = 0;
    let borrowedChange = 0;

    if (oldStatus === "PENDING") reservedChange--;
    else if (oldStatus === "BORROWED") borrowedChange--;

    if (newStatus === "PENDING") reservedChange++;
    else if (newStatus === "BORROWED") borrowedChange++;

    return { reservedChange, borrowedChange };
  };

  describe("known transition deltas", () => {
    const cases: [BorrowStatus, BorrowStatus, DeltaResult][] = [
      ["PENDING", "BORROWED", { reservedChange: -1, borrowedChange: 1 }],
      ["PENDING", "REJECTED", { reservedChange: -1, borrowedChange: 0 }],
      ["BORROWED", "RETURNED", { reservedChange: 0, borrowedChange: -1 }],
      ["BORROWED", "LATE_RETURN", { reservedChange: 0, borrowedChange: -1 }],
    ];

    it.each(cases)(
      "computes delta for %s → %s",
      (oldStatus, newStatus, expected) => {
        expect(computeDeltas(oldStatus, newStatus)).toEqual(expected);
      },
    );
  });

  describe("same-status transitions produce zero deltas", () => {
    it.each(ALL_STATUSES)("delta for %s → %s is zero", (status) => {
      expect(computeDeltas(status, status)).toEqual({
        reservedChange: 0,
        borrowedChange: 0,
      });
    });
  });

  describe("inverse transitions", () => {
    it("PENDING ↔ BORROWED deltas sum to zero", () => {
      const forward = computeDeltas("PENDING", "BORROWED");
      const backward = computeDeltas("BORROWED", "PENDING");
      expect(forward.reservedChange + backward.reservedChange).toBe(0);
      expect(forward.borrowedChange + backward.borrowedChange).toBe(0);
    });
  });
});
