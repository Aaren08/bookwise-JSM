-- Phase 1: Add columns as nullable
ALTER TABLE "borrow_records" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;

-- Phase 2: Backfill existing rows in batches
DO $$
DECLARE
    batch_size int := 5000;
    rows_affected int;
BEGIN
    -- Backfill borrow_records
    LOOP
        UPDATE "borrow_records"
        SET "updated_at" = now()
        WHERE "updated_at" IS NULL
        AND id IN (
            SELECT id FROM "borrow_records"
            WHERE "updated_at" IS NULL
            LIMIT batch_size
        );
        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        EXIT WHEN rows_affected = 0;
    END LOOP;

    -- Backfill books
    LOOP
        UPDATE "books"
        SET "updated_at" = now()
        WHERE "updated_at" IS NULL
        AND id IN (
            SELECT id FROM "books"
            WHERE "updated_at" IS NULL
            LIMIT batch_size
        );
        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        EXIT WHEN rows_affected = 0;
    END LOOP;

    -- Backfill users
    LOOP
        UPDATE "users"
        SET "updated_at" = now()
        WHERE "updated_at" IS NULL
        AND id IN (
            SELECT id FROM "users"
            WHERE "updated_at" IS NULL
            LIMIT batch_size
        );
        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        EXIT WHEN rows_affected = 0;
    END LOOP;
END $$;

-- Phase 3: Set Defaults and NOT NULL constraints
ALTER TABLE "borrow_records" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "borrow_records" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "books" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "books" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL;

