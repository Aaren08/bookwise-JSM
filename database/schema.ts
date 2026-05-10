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
  uniqueIndex,
  boolean,
  check,
  jsonb,
  inet,
} from "drizzle-orm/pg-core";

export const STATUS_ENUM = pgEnum("status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const ROLE_ENUM = pgEnum("role", ["USER", "ADMIN"]);

export const OWNERSHIP_TYPE_ENUM = pgEnum("ownership_type", [
  "NONE",
  "SYSTEM_OWNER",
]);

export const BORROW_STATUS_ENUM = pgEnum("borrow_status", [
  "PENDING",
  "BORROWED",
  "RETURNED",
  "LATE_RETURN",
  "REJECTED",
]);

export const SETUP_EVENT_TYPE_ENUM = pgEnum("setup_event_type", [
  "SETUP_STARTED",
  "OWNER_CREATED",
  "SETTINGS_SAVED",
  "SETUP_COMPLETED",
  "SETUP_BLOCKED_ALREADY_INITIALIZED",
]);

export const ADMIN_AUDIT_ACTION_ENUM = pgEnum("admin_audit_action", [
  "ADMIN_CREATED",
  "ADMIN_UPDATED",
  "ADMIN_DEMOTED",
  "ADMIN_DELETED",
  "OWNER_PROTECTION_BLOCKED",
  "USER_STATUS_CHANGED",
  "SETTINGS_UPDATED",
]);

export const AUDIT_SOURCE_ENUM = pgEnum("audit_source", [
  "SETUP",
  "ADMIN_PANEL",
  "API",
  "SYSTEM", // cron jobs, automated processes
  "MIGRATION", // schema migrations that touch data
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").notNull().primaryKey().defaultRandom(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: text("password").notNull(),
    status: STATUS_ENUM("status").default("PENDING").notNull(),
    role: ROLE_ENUM("role").default("USER").notNull(),
    ownershipType: OWNERSHIP_TYPE_ENUM("ownership_type")
      .default("NONE")
      .notNull(),
    ownershipAssignedAt: timestamp("ownership_assigned_at", {
      withTimezone: true,
    }),
    sessionVersion: integer("session_version").notNull().default(1),
    lastActivityDate: date("last_activity_date").defaultNow(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("users_role_idx").on(table.role),
    index("users_status_idx").on(table.status),
    index("users_created_at_idx").on(table.createdAt),
    uniqueIndex("users_single_system_owner_idx")
      .on(table.ownershipType)
      .where(sql`${table.ownershipType} = 'SYSTEM_OWNER'`),
    check(
      "users_owner_must_be_admin_chk",
      sql`${table.ownershipType} = 'NONE' OR ${table.role} = 'ADMIN'`,
    ),
  ],
) as unknown as ReturnType<typeof pgTable>;

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 255 }), // denormalized for profile reads without joining users
    universityId: varchar("university_id", { length: 30 }),
    universityCard: text("university_card"),
    userAvatar: text("user_avatar"),
    userAvatarFileId: text("user_avatar_file_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_profiles_university_id_idx")
      .on(table.universityId)
      .where(sql`${table.universityId} IS NOT NULL`),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: boolean("id").primaryKey().default(true).notNull(),
    initializedAt: timestamp("initialized_at", { withTimezone: true }),
    borrowDurationDays: integer("borrow_duration_days").notNull(),
    supportEmail: varchar("support_email", { length: 255 }).notNull(),
    websiteUrl: text("website_url").notNull(),
    universityName: varchar("university_name", { length: 255 }).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    setupCompleted: boolean("setup_completed").default(false).notNull(),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    setupCompletedBy: uuid("setup_completed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    check("app_settings_singleton_chk", sql`${table.id} = true`),
    check(
      "app_settings_borrow_duration_chk",
      sql`${table.borrowDurationDays} BETWEEN 1 AND 365`,
    ),
    check("app_settings_support_email_chk", sql`${table.supportEmail} <> ''`),
    check("app_settings_website_url_chk", sql`${table.websiteUrl} <> ''`),
    check(
      "app_settings_university_name_chk",
      sql`${table.universityName} <> ''`,
    ),
  ],
);

export const setupEvents = pgTable(
  "setup_events",
  {
    id: uuid("id").notNull().primaryKey().defaultRandom(),
    eventType: SETUP_EVENT_TYPE_ENUM("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    requestId: uuid("request_id"),
    source: AUDIT_SOURCE_ENUM("source"),
    sessionId: text("session_id"), // hashed, not raw
    correlationId: uuid("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("setup_events_event_type_idx").on(table.eventType),
    index("setup_events_actor_user_id_idx").on(table.actorUserId),
    index("setup_events_created_at_idx").on(table.createdAt),
  ],
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").notNull().primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetUserId: uuid("target_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: ADMIN_AUDIT_ACTION_ENUM("action").notNull(),
    previousValues: jsonb("previous_values"),
    newValues: jsonb("new_values"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    requestId: uuid("request_id"),
    source: AUDIT_SOURCE_ENUM("source"),
    sessionId: text("session_id"), // hashed, not raw
    correlationId: uuid("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("admin_audit_logs_actor_user_id_idx").on(table.actorUserId),
    index("admin_audit_logs_target_user_id_idx").on(table.targetUserId),
    index("admin_audit_logs_action_idx").on(table.action),
    index("admin_audit_logs_created_at_idx").on(table.createdAt),
  ],
);

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
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("available_copies_idx").on(table.availableCopies)],
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

    isAdminCleared: boolean("is_admin_cleared").default(false).notNull(),
    dismissed: integer("dismissed").default(0).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("book_status_idx").on(table.bookId, table.borrowStatus),
    index("borrow_date_idx").on(table.borrowDate),
    index("reserved_at_idx").on(table.reservedAt),
  ],
);
