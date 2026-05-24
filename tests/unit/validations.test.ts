import { describe, it, expect } from "vitest";
import { signUpSchema, signInSchema, bookSchema } from "@/lib/validations";

describe("signUpSchema", () => {
  const validPayload = {
    fullName: "Jane Doe",
    email: "jane@example.com",
    universityId: "STU12345",
    password: "securePass1",
    universityCard: "https://img.example.com/card.jpg",
  };

  it("accepts a well-formed payload", () => {
    expect(signUpSchema.safeParse(validPayload).success).toBe(true);
  });

  describe("fullName", () => {
    it("rejects less than 3 characters", () => {
      expect(signUpSchema.safeParse({ ...validPayload, fullName: "AB" }).success).toBe(false);
    });
    it("rejects empty string", () => {
      expect(signUpSchema.safeParse({ ...validPayload, fullName: "" }).success).toBe(false);
    });
    it("accepts exactly 3 characters", () => {
      expect(signUpSchema.safeParse({ ...validPayload, fullName: "Bob" }).success).toBe(true);
    });
    it("accepts unicode characters", () => {
      expect(signUpSchema.safeParse({ ...validPayload, fullName: "José María" }).success).toBe(true);
    });
    it("accepts XSS-like content (still a string)", () => {
      expect(
        signUpSchema.safeParse({ ...validPayload, fullName: '<script>alert("xss")</script>' }).success,
      ).toBe(true);
    });
  });

  describe("email", () => {
    it("rejects missing @", () => {
      expect(signUpSchema.safeParse({ ...validPayload, email: "notanemail" }).success).toBe(false);
    });
    it("rejects missing domain", () => {
      expect(signUpSchema.safeParse({ ...validPayload, email: "user@" }).success).toBe(false);
    });
    it("accepts subdomain email", () => {
      expect(signUpSchema.safeParse({ ...validPayload, email: "user@sub.example.com" }).success).toBe(true);
    });
    it("rejects empty email", () => {
      expect(signUpSchema.safeParse({ ...validPayload, email: "" }).success).toBe(false);
    });
  });

  describe("universityId", () => {
    it("rejects empty", () => {
      expect(signUpSchema.safeParse({ ...validPayload, universityId: "" }).success).toBe(false);
    });
    it("accepts any non-empty string", () => {
      expect(signUpSchema.safeParse({ ...validPayload, universityId: "2024-0001" }).success).toBe(true);
    });
  });

  describe("password", () => {
    it("rejects < 8 chars", () => {
      expect(signUpSchema.safeParse({ ...validPayload, password: "1234567" }).success).toBe(false);
    });
    it("accepts exactly 8 chars", () => {
      expect(signUpSchema.safeParse({ ...validPayload, password: "12345678" }).success).toBe(true);
    });
    it("accepts special characters", () => {
      expect(signUpSchema.safeParse({ ...validPayload, password: "P@ssw0rd!" }).success).toBe(true);
    });
    it("accepts very long password (128 chars)", () => {
      expect(signUpSchema.safeParse({ ...validPayload, password: "a".repeat(128) }).success).toBe(true);
    });
  });

  describe("universityCard", () => {
    it("rejects empty", () => {
      expect(signUpSchema.safeParse({ ...validPayload, universityCard: "" }).success).toBe(false);
    });
    it("accepts URL", () => {
      expect(signUpSchema.safeParse({ ...validPayload, universityCard: "https://example.com/card.png" }).success).toBe(true);
    });
  });

  describe("missing required fields", () => {
    const required = ["fullName", "email", "password", "universityId", "universityCard"] as const;
    it.each(required)("rejects when %s is missing", (field) => {
      const { [field]: _, ...rest } = validPayload;
      expect(signUpSchema.safeParse(rest).success).toBe(false);
    });
  });

  it("strips unknown fields", () => {
    const result = signUpSchema.safeParse({ ...validPayload, extraField: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("extraField" in result.data).toBe(false);
    }
  });

  describe("incorrect types", () => {
    it("rejects non-string fullName", () => {
      expect(signUpSchema.safeParse({ ...validPayload, fullName: 123 }).success).toBe(false);
    });
    it("rejects null email", () => {
      expect(signUpSchema.safeParse({ ...validPayload, email: null }).success).toBe(false);
    });
    it("rejects null password", () => {
      expect(signUpSchema.safeParse({ ...validPayload, password: null }).success).toBe(false);
    });
  });
});

describe("signInSchema", () => {
  const valid = { email: "jane@example.com", password: "securePass1" };

  it("accepts valid payload", () => expect(signInSchema.safeParse(valid).success).toBe(true));
  it("rejects short password", () => expect(signInSchema.safeParse({ ...valid, password: "1234567" }).success).toBe(false));
  it("rejects invalid email", () => expect(signInSchema.safeParse({ ...valid, email: "bad" }).success).toBe(false));
  it("rejects empty email", () => expect(signInSchema.safeParse({ ...valid, email: "" }).success).toBe(false));
  it("rejects missing password", () => {
    const { password, ...rest } = valid;
    expect(signInSchema.safeParse(rest).success).toBe(false);
  });
  it("rejects missing email", () => {
    const { email, ...rest } = valid;
    expect(signInSchema.safeParse(rest).success).toBe(false);
  });
  it("strips extra fields", () => {
    const result = signInSchema.safeParse({ ...valid, rememberMe: true });
    expect(result.success).toBe(true);
    if (result.success) expect("rememberMe" in result.data).toBe(false);
  });
});

describe("bookSchema", () => {
  const validBook = {
    title: "The Great Gatsby",
    description: "A story of wealth, love, and the American Dream set in the 1920s.",
    author: "F. Scott Fitzgerald",
    genre: "Fiction",
    rating: 4,
    totalCopies: 10,
    coverUrl: "https://example.com/cover.jpg",
    coverColor: "#FF5733",
    videoUrl: "https://example.com/trailer.mp4",
    summary: "A classic novel about Jay Gatsby and his pursuit of Daisy Buchanan.",
  };

  it("accepts a well-formed book", () => {
    expect(bookSchema.safeParse(validBook).success).toBe(true);
  });

  describe("title", () => {
    it("rejects < 2 chars", () => expect(bookSchema.safeParse({ ...validBook, title: "A" }).success).toBe(false));
    it("rejects > 100 chars", () => expect(bookSchema.safeParse({ ...validBook, title: "A".repeat(101) }).success).toBe(false));
    it("accepts exactly 2 chars", () => expect(bookSchema.safeParse({ ...validBook, title: "AB" }).success).toBe(true));
    it("accepts exactly 100 chars", () => expect(bookSchema.safeParse({ ...validBook, title: "A".repeat(100) }).success).toBe(true));
    it("trims whitespace", () => {
      const r = bookSchema.safeParse({ ...validBook, title: "  Title  " });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.title).toBe("Title");
    });
    it("rejects whitespace-only", () => expect(bookSchema.safeParse({ ...validBook, title: "   " }).success).toBe(false));
  });

  describe("description", () => {
    it("rejects < 2 chars", () => expect(bookSchema.safeParse({ ...validBook, description: "A" }).success).toBe(false));
    it("rejects > 1000 chars", () => expect(bookSchema.safeParse({ ...validBook, description: "A".repeat(1001) }).success).toBe(false));
    it("accepts 1000 chars", () => expect(bookSchema.safeParse({ ...validBook, description: "A".repeat(1000) }).success).toBe(true));
  });

  describe("author", () => {
    it("rejects < 2 chars", () => expect(bookSchema.safeParse({ ...validBook, author: "A" }).success).toBe(false));
    it("rejects > 100 chars", () => expect(bookSchema.safeParse({ ...validBook, author: "A".repeat(101) }).success).toBe(false));
  });

  describe("genre", () => {
    it("rejects < 2 chars", () => expect(bookSchema.safeParse({ ...validBook, genre: "A" }).success).toBe(false));
    it("rejects > 50 chars", () => expect(bookSchema.safeParse({ ...validBook, genre: "A".repeat(51) }).success).toBe(false));
  });

  describe("rating", () => {
    it("rejects < 1", () => expect(bookSchema.safeParse({ ...validBook, rating: 0 }).success).toBe(false));
    it("rejects > 5", () => expect(bookSchema.safeParse({ ...validBook, rating: 6 }).success).toBe(false));
    it("coerces string", () => {
      const r = bookSchema.safeParse({ ...validBook, rating: "4" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.rating).toBe(4);
    });
    it("accepts 1 (min)", () => expect(bookSchema.safeParse({ ...validBook, rating: 1 }).success).toBe(true));
    it("accepts 5 (max)", () => expect(bookSchema.safeParse({ ...validBook, rating: 5 }).success).toBe(true));
    it("rejects NaN", () => expect(bookSchema.safeParse({ ...validBook, rating: NaN }).success).toBe(false));
    it("rejects non-numeric string", () => expect(bookSchema.safeParse({ ...validBook, rating: "abc" }).success).toBe(false));
  });

  describe("totalCopies", () => {
    it("rejects 0", () => expect(bookSchema.safeParse({ ...validBook, totalCopies: 0 }).success).toBe(false));
    it("rejects negative", () => expect(bookSchema.safeParse({ ...validBook, totalCopies: -1 }).success).toBe(false));
    it("rejects > 10000", () => expect(bookSchema.safeParse({ ...validBook, totalCopies: 10001 }).success).toBe(false));
    it("accepts 10000", () => expect(bookSchema.safeParse({ ...validBook, totalCopies: 10000 }).success).toBe(true));
    it("coerces string", () => {
      const r = bookSchema.safeParse({ ...validBook, totalCopies: "5" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.totalCopies).toBe(5);
    });
    it("rejects float", () => expect(bookSchema.safeParse({ ...validBook, totalCopies: 5.5 }).success).toBe(false));
  });

  describe("coverUrl", () => {
    it("rejects empty", () => expect(bookSchema.safeParse({ ...validBook, coverUrl: "" }).success).toBe(false));
  });

  describe("coverColor", () => {
    it("rejects missing #", () => expect(bookSchema.safeParse({ ...validBook, coverColor: "FF5733" }).success).toBe(false));
    it("rejects wrong length", () => expect(bookSchema.safeParse({ ...validBook, coverColor: "#FFF" }).success).toBe(false));
    it("accepts lowercase hex (regex has i flag)", () => {
      expect(bookSchema.safeParse({ ...validBook, coverColor: "#ff5733" }).success).toBe(true);
    });
    it("accepts uppercase hex", () => expect(bookSchema.safeParse({ ...validBook, coverColor: "#A1B2C3" }).success).toBe(true));
    it("trims whitespace", () => {
      const r = bookSchema.safeParse({ ...validBook, coverColor: "  #A1B2C3  " });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.coverColor).toBe("#A1B2C3");
    });
  });

  describe("videoUrl", () => {
    it("rejects empty", () => expect(bookSchema.safeParse({ ...validBook, videoUrl: "" }).success).toBe(false));
  });

  describe("summary", () => {
    it("rejects < 10 chars", () => expect(bookSchema.safeParse({ ...validBook, summary: "Short" }).success).toBe(false));
    it("trims whitespace", () => {
      const r = bookSchema.safeParse({ ...validBook, summary: "  A very long summary indeed for this book  " });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.summary).toBe("A very long summary indeed for this book");
    });
  });

  describe("missing required fields", () => {
    const fields = ["title", "description", "author", "genre", "rating", "totalCopies", "coverUrl", "coverColor", "videoUrl", "summary"] as const;
    it.each(fields)("rejects when %s is missing", (field) => {
      const { [field]: _, ...rest } = validBook;
      expect(bookSchema.safeParse(rest).success).toBe(false);
    });
  });

  describe("edge case payloads", () => {
    it("accepts XSS-like strings", () => {
      expect(
        bookSchema.safeParse({ ...validBook, title: '<script>alert("xss")</script>' }).success,
      ).toBe(true);
    });
    it("accepts unicode-heavy strings", () => {
      expect(
        bookSchema.safeParse({ ...validBook, title: "日本語の本", author: "François Müller" }).success,
      ).toBe(true);
    });
    it("rejects excessively long fields", () => {
      expect(
        bookSchema.safeParse({ ...validBook, title: "A".repeat(101), description: "A".repeat(1001) }).success,
      ).toBe(false);
    });
  });

  describe("incorrect types", () => {
    it("rejects array for title", () => expect(bookSchema.safeParse({ ...validBook, title: ["title"] }).success).toBe(false));
    it("rejects null coverUrl", () => expect(bookSchema.safeParse({ ...validBook, coverUrl: null }).success).toBe(false));
    it("rejects undefined rating", () => expect(bookSchema.safeParse({ ...validBook, rating: undefined }).success).toBe(false));
  });
});
