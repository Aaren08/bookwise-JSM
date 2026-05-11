CREATE TYPE "public"."admin_audit_action" AS ENUM('ADMIN_CREATED', 'ADMIN_UPDATED', 'ADMIN_DEMOTED', 'ADMIN_DELETED', 'USER_STATUS_CHANGED', 'SETTINGS_UPDATED');--> statement-breakpoint
CREATE TYPE "public"."audit_source" AS ENUM('SETUP', 'ADMIN_PANEL', 'API', 'SYSTEM', 'MIGRATION');--> statement-breakpoint
CREATE TYPE "public"."borrow_status" AS ENUM('PENDING', 'BORROWED', 'RETURNED', 'LATE_RETURN', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."setup_event_type" AS ENUM('SETUP_STARTED', 'OWNER_CREATED', 'SETTINGS_SAVED', 'SETUP_COMPLETED', 'SETUP_BLOCKED_ALREADY_INITIALIZED');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"action" "admin_audit_action" NOT NULL,
	"previous_values" jsonb,
	"new_values" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" uuid,
	"source" "audit_source",
	"session_id" text,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"initialized_at" timestamp with time zone,
	"setup_completed" boolean DEFAULT false NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"setup_completed_by" uuid,
	"borrow_duration_days" integer NOT NULL,
	"support_email" varchar(255) NOT NULL,
	"website_url" text NOT NULL,
	"university_name" varchar(255) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton_chk" CHECK ("app_settings"."id" = true),
	CONSTRAINT "app_settings_borrow_duration_chk" CHECK ("app_settings"."borrow_duration_days" BETWEEN 1 AND 365),
	CONSTRAINT "app_settings_support_email_chk" CHECK ("app_settings"."support_email" <> ''),
	CONSTRAINT "app_settings_website_url_chk" CHECK ("app_settings"."website_url" <> ''),
	CONSTRAINT "app_settings_university_name_chk" CHECK ("app_settings"."university_name" <> ''),
	CONSTRAINT "app_settings_no_reinit_chk" CHECK ("app_settings"."setup_completed" = false OR "app_settings"."initialized_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"author" varchar(255) NOT NULL,
	"genre" varchar(255) NOT NULL,
	"rating" real DEFAULT 0 NOT NULL,
	"total_copies" integer DEFAULT 1 NOT NULL,
	"borrowed_count" integer DEFAULT 0 NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"available_copies" integer GENERATED ALWAYS AS (total_copies - borrowed_count - reserved_count) STORED NOT NULL,
	"description" text NOT NULL,
	"cover_color" varchar(7) NOT NULL,
	"cover_url" text NOT NULL,
	"video_url" text NOT NULL,
	"summary" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "borrow_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"borrow_date" timestamp with time zone DEFAULT now() NOT NULL,
	"due_date" date NOT NULL,
	"return_date" date,
	"borrow_status" "borrow_status" DEFAULT 'PENDING' NOT NULL,
	"reserved_at" timestamp with time zone,
	"is_admin_cleared" boolean DEFAULT false NOT NULL,
	"dismissed" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "setup_event_type" NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" uuid,
	"source" "audit_source",
	"session_id" text,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"status" "status" DEFAULT 'PENDING' NOT NULL,
	"role" "role" DEFAULT 'USER' NOT NULL,
	"university_id" varchar(30),
	"university_card" text,
	"user_avatar" text,
	"user_avatar_file_id" text,
	"session_version" integer DEFAULT 1 NOT NULL,
	"last_activity_date" date DEFAULT now(),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_setup_completed_by_users_id_fk" FOREIGN KEY ("setup_completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow_records" ADD CONSTRAINT "borrow_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow_records" ADD CONSTRAINT "borrow_records_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_events" ADD CONSTRAINT "setup_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_actor_user_id_idx" ON "admin_audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_user_id_idx" ON "admin_audit_logs" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_request_id_idx" ON "admin_audit_logs" USING btree ("request_id") WHERE "admin_audit_logs"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_correlation_id_idx" ON "admin_audit_logs" USING btree ("correlation_id") WHERE "admin_audit_logs"."correlation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "available_copies_idx" ON "books" USING btree ("available_copies");--> statement-breakpoint
CREATE INDEX "book_status_idx" ON "borrow_records" USING btree ("book_id","borrow_status");--> statement-breakpoint
CREATE INDEX "borrow_date_idx" ON "borrow_records" USING btree ("borrow_date");--> statement-breakpoint
CREATE INDEX "reserved_at_idx" ON "borrow_records" USING btree ("reserved_at");--> statement-breakpoint
CREATE INDEX "setup_events_event_type_idx" ON "setup_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "setup_events_actor_user_id_idx" ON "setup_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "setup_events_created_at_idx" ON "setup_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "setup_events_request_id_idx" ON "setup_events" USING btree ("request_id") WHERE "setup_events"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_university_id_idx" ON "users" USING btree ("university_id") WHERE "users"."university_id" IS NOT NULL;