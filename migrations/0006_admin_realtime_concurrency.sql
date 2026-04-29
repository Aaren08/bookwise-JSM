ALTER TABLE "borrow_records"
ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "books"
ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "users"
ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
