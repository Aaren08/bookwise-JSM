ALTER TYPE "public"."borrow_status" ADD VALUE 'PENDING' BEFORE 'BORROWED';--> statement-breakpoint
ALTER TYPE "public"."borrow_status" ADD VALUE 'REJECTED';--> statement-breakpoint
ALTER TABLE "books" DROP CONSTRAINT "books_id_unique";--> statement-breakpoint
ALTER TABLE "borrow_records" DROP CONSTRAINT "borrow_records_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_id_unique";--> statement-breakpoint
ALTER TABLE "borrow_records" ALTER COLUMN "borrow_status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "university_id" SET DATA TYPE varchar(30);--> statement-breakpoint
ALTER TABLE "borrow_records" ADD COLUMN "reserved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "user_avatar" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "user_avatar_file_id" text;--> statement-breakpoint
-- Add source counter columns BEFORE the generated column that references them
ALTER TABLE "books" ADD COLUMN "borrowed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "reserved_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Seed borrowed_count from existing BORROWED records (data integrity for legacy rows)
UPDATE "books" b SET "borrowed_count" = (
  SELECT COUNT(*) FROM "borrow_records" br
  WHERE br."book_id" = b."id" AND br."borrow_status" = 'BORROWED'
);--> statement-breakpoint
-- Seed reserved_count from existing PENDING records (data integrity for legacy rows)
UPDATE "books" b SET "reserved_count" = (
  SELECT COUNT(*) FROM "borrow_records" br
  WHERE br."book_id" = b."id" AND br."borrow_status" = 'PENDING'
);--> statement-breakpoint
-- Now safe to drop old stored column and recreate as GENERATED ALWAYS AS
ALTER TABLE "books" ALTER COLUMN "available_copies" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "available_copies";--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "available_copies" integer GENERATED ALWAYS AS (total_copies - borrowed_count - reserved_count) STORED NOT NULL;