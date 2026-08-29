import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * The Postgres connection.
 *
 * `import "server-only"` is the outer guard: this module holds the credentials
 * and the unscoped query builder, so importing it from a Client Component
 * should be a build error rather than a code review catch. Next.js resolves
 * that specifier internally — it is not an npm dependency.
 *
 * The handle is built lazily and memoised. Building it at module scope would
 * make `DATABASE_URL` a requirement of `next build`, not just of running the
 * app, and would open a pool in every process that so much as imports a table
 * definition.
 */

export type Database = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | undefined;
let database: Database | undefined;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set — see .env.example");
  }
  return url;
}

export function getDb(): Database {
  if (database === undefined) {
    // postgres.js already parses float8 (OID 701) to a JS number, which is what
    // the matching engine's arithmetic expects — no custom type handler needed.
    client = postgres(connectionString(), { onnotice: () => {} });
    database = drizzle(client, { schema });
  }
  return database;
}

/**
 * Close the pool. Production never calls this — the process holds the pool for
 * its lifetime — but tests and one-shot scripts need it to exit.
 */
export async function closeDb(): Promise<void> {
  const open = client;
  client = undefined;
  database = undefined;
  if (open !== undefined) {
    await open.end({ timeout: 5 });
  }
}
