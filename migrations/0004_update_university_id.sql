ALTER TABLE "users" ALTER COLUMN "university_id" TYPE varchar(30) USING "university_id"::varchar;
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_university_id_unique";
ALTER TABLE "users" ADD CONSTRAINT "users_university_id_unique" UNIQUE("university_id");
