import { sql } from "drizzle-orm";
import {
  integer,
  uuid,
  pgTable,
  text,
  varchar,
  pgEnum,
  date,
  timestamp,
  real,
  index,
} from "drizzle-orm/pg-core";

export const STATUS_ENUM = pgEnum("status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const ROLE_ENUM = pgEnum("role", ["USER", "ADMIN"]);

export const BORROW_STATUS_ENUM = pgEnum("borrow_status", [
  "PENDING",
  "BORROWED",
  "RETURNED",
  "LATE_RETURN",
  "REJECTED",
]);

export const users = pgTable("users", {
  id: uuid("id").notNull().primaryKey().defaultRandom(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  userAvatar: text("user_avatar"),
  userAvatarFileId: text("user_avatar_file_id"),
  email: varchar("email", { length: 255 }).notNull().unique(),
  universityId: varchar("university_id", { length: 30 }).notNull().unique(),
  password: text("password").notNull(),
  universityCard: text("university_card").notNull(),
  status: STATUS_ENUM("status").default("PENDING"),
  role: ROLE_ENUM("role").default("USER"),
  sessionVersion: integer("session_version").notNull().default(1),
  lastActivityDate: date("last_activity_date").defaultNow(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const books = pgTable(
  "books",
  {
    id: uuid("id").notNull().primaryKey().defaultRandom(),
    title: varchar("title", { length: 255 }).notNull(),
    author: varchar("author", { length: 255 }).notNull(),
    genre: varchar("genre", { length: 255 }).notNull(),
    rating: real("rating").notNull().default(0),
    totalCopies: integer("total_copies").notNull().default(1),
    // Managed explicitly by application transactions (never set manually)
    borrowedCount: integer("borrowed_count").notNull().default(0),
    reservedCount: integer("reserved_count").notNull().default(0),
    // GENERATED ALWAYS AS (total_copies - borrowed_count - reserved_count) STORED
    // PostgreSQL ensures this can never be inconsistent with the two source columns.
    availableCopies: integer("available_copies")
      .generatedAlwaysAs(sql`total_copies - borrowed_count - reserved_count`)
      .notNull(),
    description: text("description").notNull(),
    coverColor: varchar("cover_color", { length: 7 }).notNull(),
    coverUrl: text("cover_url").notNull(),
    videoUrl: text("video_url").notNull(),
    summary: text("summary").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      availableCopiesIdx: index("available_copies_idx").on(
        table.availableCopies,
      ),
    };
  },
);

export const borrowRecords = pgTable(
  "borrow_records",
  {
    id: uuid("id").notNull().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    bookId: uuid("book_id")
      .references(() => books.id)
      .notNull(),
    borrowDate: timestamp("borrow_date", { withTimezone: true })
      .defaultNow()
      .notNull(),
    dueDate: date("due_date").notNull(),
    returnDate: date("return_date"),
    borrowStatus: BORROW_STATUS_ENUM("borrow_status")
      .default("PENDING")
      .notNull(),
    // Timestamp set when status = PENDING; used by expiration cron to detect stale reservations.
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    dismissed: integer("dismissed").default(0).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      bookStatusIdx: index("book_status_idx").on(
        table.bookId,
        table.borrowStatus,
      ),
      borrowDateIdx: index("borrow_date_idx").on(table.borrowDate),
      reservedAtIdx: index("reserved_at_idx").on(table.reservedAt),
    };
  },
);
