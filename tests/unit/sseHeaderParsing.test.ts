import { describe, it, expect } from "vitest";

const parseLastEventId = (request: Request) => {
  const rawValue = request.headers.get("last-event-id");

  if (!rawValue) return null;

  const parsed = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) ? parsed : null;
};

const mockRequest = (lastEventId: string | null): Request =>
  new Request("http://localhost", {
    headers: lastEventId !== null ? { "last-event-id": lastEventId } : {},
  });

describe("parseLastEventId", () => {
  describe("valid inputs", () => {
    it("parses a positive integer string", () => {
      expect(parseLastEventId(mockRequest("42"))).toBe(42);
    });
    it("parses zero", () => expect(parseLastEventId(mockRequest("0"))).toBe(0));
    it("parses a large integer string", () => expect(parseLastEventId(mockRequest("999999"))).toBe(999999));
    it("parses negative numbers", () => expect(parseLastEventId(mockRequest("-1"))).toBe(-1));
  });

  describe("edge cases", () => {
    it("returns null when header is absent", () => expect(parseLastEventId(mockRequest(null))).toBeNull());
    it("returns null for empty string header", () => expect(parseLastEventId(mockRequest(""))).toBeNull());
    it("returns null for non-numeric string", () => expect(parseLastEventId(mockRequest("abc"))).toBeNull());

    it("parses float as floor integer (parseInt behavior)", () => {
      expect(parseLastEventId(mockRequest("3.5"))).toBe(3);
    });

    it("returns null for NaN string", () => expect(parseLastEventId(mockRequest("NaN"))).toBeNull());
    it("returns null for Infinity string", () => expect(parseLastEventId(mockRequest("Infinity"))).toBeNull());

    it("handles whitespace-padded integer", () => {
      expect(parseLastEventId(mockRequest("  42  "))).toBe(42);
    });

    it("parses leading zeros", () => expect(parseLastEventId(mockRequest("0005"))).toBe(5));
    it("parses Number.MAX_SAFE_INTEGER", () => expect(parseLastEventId(mockRequest(String(Number.MAX_SAFE_INTEGER)))).toBe(Number.MAX_SAFE_INTEGER));

    it("returns 0 for hex-like '0x1A' (parseInt stops at 'x')", () => {
      expect(parseLastEventId(mockRequest("0x1A"))).toBe(0);
    });

    it("returns 0 for octal-like '0o17' (parseInt stops at 'o')", () => {
      expect(parseLastEventId(mockRequest("0o17"))).toBe(0);
    });
  });
});
