import { randomUUID } from "node:crypto";

/**
 * The credentials the smoke suite signs up with (SPEC.md §4 "Test credentials").
 *
 * None of them is written into a file. They are generated when the config is
 * first loaded and reach `global-setup.ts` and the app's own process through
 * the environment — the same call `docker-compose.test.yml` makes when it picks
 * trust authentication rather than inventing a password to commit.
 *
 * **"Generated once" needs the read-back below.** Playwright loads
 * `playwright.config.ts` in the main process and then again in every worker
 * process, so a bare `randomUUID()` at module scope would mint a *different*
 * signup token per worker — while the app under test only ever accepts the one
 * its own environment was started with. Workers are spawned after the first
 * load and inherit `process.env`, so writing the value back is what makes every
 * later load agree with the first. The failure this avoids is not a crash: it
 * is a suite that passes on one worker and reports "that signup token is not
 * valid for this deployment" on the next.
 *
 * Deliberately `E2E_`-prefixed rather than reusing `HOUSEHOLD_SIGNUP_TOKEN`
 * directly. A developer with a real deployment token exported in their shell
 * would otherwise have the suite silently adopt it; `playwright.config.ts` maps
 * this onto the variable the app reads, and the app's own value is always the
 * generated one.
 */

const SIGNUP_TOKEN_VAR = "E2E_SIGNUP_TOKEN";
const PASSWORD_VAR = "E2E_PASSWORD";
const EMAIL_VAR = "E2E_EMAIL";
const HOUSEHOLD_VAR = "E2E_HOUSEHOLD_NAME";

function generated(name: string, shape: (id: string) => string = (id) => id): string {
  const inherited = process.env[name];
  if (inherited !== undefined && inherited !== "") return inherited;

  const value = shape(randomUUID());
  process.env[name] = value;
  return value;
}

export const E2E_SIGNUP_TOKEN = generated(SIGNUP_TOKEN_VAR);

export const E2E_PASSWORD = generated(PASSWORD_VAR);

/**
 * Fresh per run, and `.test` because RFC 6761 reserves it as never-resolvable —
 * nothing here should be one typo away from mailing a real address.
 *
 * Uniqueness is what lets a second `npm run test:e2e` succeed against a warm
 * database: signing up reuses the address otherwise and fails with "that email
 * address already has an account". It also means every run gets its own
 * household, so rows left behind by an earlier run are another tenant's and
 * invisible to this one — the isolation the app already guarantees, used as
 * test hygiene.
 */
export const E2E_EMAIL = generated(EMAIL_VAR, (id) => `e2e-${id}@example.test`);

export const E2E_HOUSEHOLD_NAME = generated(HOUSEHOLD_VAR, (id) => `E2E ${id.slice(0, 8)}`);
