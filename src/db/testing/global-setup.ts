import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { closeDb } from "../client";
import { TEST_DATABASE_URL, testDb } from "./harness";

/**
 * Brings up the throwaway Postgres and applies the migrations, once per run.
 *
 * Only the `db` vitest project uses this, so the pure-logic suite still runs
 * without Docker (`npm test -- src/lib/matching/match.test.ts` touches nothing
 * here).
 *
 * The container is left running afterwards — re-running the suite against a
 * warm database is the common case. `npm run db:test:down` stops it.
 */

const run = promisify(execFile);

const COMPOSE_ARGS = ["compose", "-f", "docker-compose.test.yml"];

async function startContainer(): Promise<void> {
  try {
    // `--wait` blocks on the service's healthcheck, so by the time this
    // resolves Postgres is accepting connections — no polling loop needed.
    await run("docker", [...COMPOSE_ARGS, "up", "-d", "--wait"], {
      cwd: process.cwd(),
      timeout: 180_000,
    });
  } catch (cause) {
    throw new Error(
      "Could not start the test database. The DB suite needs Docker running, " +
        "or TEST_DATABASE_URL pointing at a Postgres you have already started. " +
        "See docker-compose.test.yml.",
      { cause },
    );
  }
}

export async function setup(): Promise<void> {
  if (process.env.TEST_DATABASE_URL === undefined) {
    await startContainer();
  }

  try {
    await migrate(testDb(), { migrationsFolder: "drizzle" });
  } finally {
    // The migrator's pool belongs to this process; the tests run in workers and
    // open their own.
    await closeDb();
  }
}

export async function teardown(): Promise<void> {
  await closeDb();
}

export { TEST_DATABASE_URL };
