import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit reads this for `db:generate` (diff the schema, emit SQL) and
 * `db:migrate`. Migrations are checked in and applied as SQL — the schema file
 * is never pushed straight at a database, so what ran in production is
 * reviewable in the diff.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
