import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/database/schema";
import config from "@/lib/config";

const globalForDb = globalThis as unknown as {
  postgresClient?: postgres.Sql;
};

const databaseUrl = config.env.databaseUrl;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (
  process.env.NODE_ENV === "production" &&
  !databaseUrl.includes("-pooler.")
) {
  console.warn(
    "DATABASE_URL does not look like a Neon pooled connection URL. Use the pooled URL for serverless/Next.js deployments.",
  );
}

export const sqlClient =
  globalForDb.postgresClient ??
  postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: Number(process.env.POSTGRES_MAX_CONNECTIONS ?? 5),
    onnotice: (notice) => {
      if (process.env.NODE_ENV !== "production") {
        console.info("[postgres notice]", notice.message);
      }
    },
    prepare: false,
    ssl: "require",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.postgresClient = sqlClient;
}

export const db = drizzle(sqlClient, { schema });
