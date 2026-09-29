/**
 * Where the app under test listens, and what it talks to.
 *
 * Both values are deliberately not the ones a developer runs by hand.
 *
 * **Port 3100, not 3000.** `npm run test:e2e` builds and starts a real
 * production server; if it shared a port with `npm run dev` the suite would
 * either refuse to bind or — worse, with `reuseExistingServer` — quietly drive
 * the dev server instead, which is a different build, pointed at a different
 * database, with no signup token configured.
 *
 * **Port 55432, not 5432**, for the reason `docker-compose.test.yml` gives at
 * length: the smoke run signs up households and leaves the rows behind, and a
 * running dev database must never be the thing a test suite writes into.
 *
 * `TEST_DATABASE_URL` is honoured so the two suites stay interchangeable, and
 * the literal below is the same string `src/db/testing/harness.ts` defaults to.
 * Duplicated rather than imported: that module reaches `src/db/client.ts`,
 * which opens with `import "server-only"` — a specifier Next resolves
 * internally and the Playwright runner cannot resolve at all. `packaging.test.ts`
 * asserts the two strings have not drifted apart.
 */

export const E2E_PORT = 3100;

export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const DEFAULT_DATABASE_URL = "postgres://postgres@127.0.0.1:55432/stockt_test";

const THROWAWAY_SUFFIX = "_test";

/**
 * Refuse to point the smoke suite at anything but a throwaway database.
 *
 * The same backstop `src/db/testing/harness.ts` puts in front of its
 * `TRUNCATE`, and this side needs it more: `global-setup.ts` runs
 * `drizzle-kit migrate`, which applies whatever DDL is in `drizzle/` —
 * `ALTER` and `DROP` included — and then signs up a household. The literal
 * above is safe, but `TEST_DATABASE_URL` overrides it, and a developer who
 * exported it for the vitest `db` project (or followed CLAUDE.md's
 * containerised-Playwright recipe) now has it in scope for `npm run verify`
 * too. Checking the value that is actually resolved is the only check that
 * means anything; asserting the source literal only ever guards the default.
 */
export function throwawayDatabaseUrl(raw: string): string {
  let databaseName: string;

  try {
    databaseName = new URL(raw).pathname.replace(/^\//, "");
  } catch {
    // Not rethrown, and no `cause`. Node's `ERR_INVALID_URL` TypeError carries
    // the entire connection string — password included — in an own enumerable
    // `input` property, which is the leak `src/db/client.ts` drops rather than
    // attaches. The name of the variable is all a caller needs here.
    throw new Error("TEST_DATABASE_URL is not a valid connection URL.");
  }

  if (!databaseName.endsWith(THROWAWAY_SUFFIX)) {
    throw new Error(
      `Refusing to run the smoke suite against database "${databaseName}": it applies ` +
        "migrations and signs up households, so it only operates on a database whose " +
        `name ends in "${THROWAWAY_SUFFIX}". Check TEST_DATABASE_URL.`,
    );
  }

  return raw;
}

export const E2E_DATABASE_URL = throwawayDatabaseUrl(
  process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL,
);

/**
 * Where `global-setup.ts` leaves the signed-in `storageState`. Both gitignored.
 *
 * Two sessions for the same user, not one. A spec that signs out deletes the
 * *session row*, so doing it on the shared state would revoke the cookie every
 * other spec in the run is holding. The disposable one exists to be destroyed.
 */
export const E2E_STORAGE_STATE = "e2e/.auth/household.json";

export const E2E_DISPOSABLE_STORAGE_STATE = "e2e/.auth/disposable.json";
