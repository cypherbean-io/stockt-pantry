import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium, type Browser, type Page } from "@playwright/test";

import { E2E_EMAIL, E2E_HOUSEHOLD_NAME, E2E_PASSWORD, E2E_SIGNUP_TOKEN } from "./credentials";
import {
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  E2E_DISPOSABLE_STORAGE_STATE,
  E2E_STORAGE_STATE,
} from "./server";

/**
 * Brings up the throwaway Postgres, migrates it, and signs up one household
 * (SPEC.md §5 "Smoke").
 *
 * The household is created **through the real `/signup` form**, not by
 * inserting rows. That exercises the `HOUSEHOLD_SIGNUP_TOKEN` gate rather than
 * routing around it, and it means the `storageState` every spec starts from is
 * a session the app itself issued — cookie flags, expiry and all. Seeding the
 * tables directly would make the suite green on a build whose login is broken.
 *
 * **Every credential is typed here and nowhere else.** That is a deliberate
 * containment boundary, not a convenience: Playwright attaches an aria snapshot
 * (`error-context.md`) to any failing test, and an aria snapshot renders the
 * value of a `type="password"` input verbatim — as do trace DOM snapshots, and
 * the HTML reporter copies both into `playwright-report/data/`. Nothing here is
 * traced or error-contexted, so the password stays in process memory. This is
 * why `shell.spec.ts` starts from a second, disposable session rather than
 * filling in the sign-in form itself.
 *
 * The database half duplicates `src/db/testing/global-setup.ts` by shelling out
 * rather than importing it: that module reaches `src/db/client.ts`, which opens
 * with `import "server-only"`. Vitest aliases that specifier to Next's no-op;
 * the Playwright runner has no such alias and would fail to resolve it.
 */

const run = promisify(execFile);

/**
 * The repo root, derived from this file rather than from `process.cwd()`.
 * `execFile` resolves a path containing a slash against the working directory,
 * so `node_modules/.bin/drizzle-kit` would otherwise depend on where the
 * developer happened to type `npx playwright test`.
 */
const repoRoot = resolve(import.meta.dirname, "..");

const COMPOSE_ARGS = ["compose", "-f", "docker-compose.test.yml"];

async function startDatabase(): Promise<void> {
  // Someone who set TEST_DATABASE_URL has started their own; the same escape
  // hatch `src/db/testing/global-setup.ts` offers. `e2e/server.ts` has already
  // refused the value if it does not name a throwaway database.
  if (process.env.TEST_DATABASE_URL !== undefined) return;

  try {
    // `--wait` blocks on the compose healthcheck, so Postgres is accepting
    // connections by the time this resolves.
    await run("docker", [...COMPOSE_ARGS, "up", "-d", "--wait"], {
      cwd: repoRoot,
      timeout: 180_000,
    });
  } catch (cause) {
    throw new Error(
      "Could not start the test database. The smoke suite needs Docker running, " +
        "or TEST_DATABASE_URL pointing at a Postgres you have already started. " +
        "See docker-compose.test.yml.",
      { cause },
    );
  }
}

async function applyMigrations(): Promise<void> {
  try {
    // From node_modules, never `npx` — the same rule the Dockerfile's migrator
    // stage follows: `npx` silently fetches the registry's latest drizzle-kit
    // when local resolution fails, with a database URL in its environment.
    await run("node_modules/.bin/drizzle-kit", ["migrate"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
      timeout: 120_000,
    });
  } catch (cause) {
    throw new Error(
      "Could not migrate the test database. Run `npm run db:test:down` and try again.",
      { cause },
    );
  }
}

/**
 * Both auth forms land on `/household`, and both refuse by rendering a
 * `role="alert"` and staying put. A bare `waitForURL` timeout would report
 * "still on /signup" and nothing about why; the messages are a fixed set in
 * `src/app/actions/auth.ts` and none of them echoes a submitted value.
 */
async function reachHousehold(page: Page, attempt: string): Promise<void> {
  try {
    await page.waitForURL("**/household", { timeout: 30_000 });
  } catch (cause) {
    const refusal = await page
      .getByRole("alert")
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => undefined);

    throw new Error(
      `${attempt} did not reach /household.` +
        (refusal === undefined ? "" : ` The form said: ${refusal}`),
      { cause },
    );
  }
}

/** Creates the household and saves the session every spec starts from. */
async function signUp(browser: Browser): Promise<void> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });

  try {
    const page = await context.newPage();

    await page.goto("/signup");
    await page.getByLabel("Signup token").fill(E2E_SIGNUP_TOKEN);
    await page.getByLabel("Household name").fill(E2E_HOUSEHOLD_NAME);
    await page.getByLabel("Email", { exact: true }).fill(E2E_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Create household" }).click();

    await reachHousehold(page, "Signing up the test household");

    const state = await context.storageState({ path: E2E_STORAGE_STATE });

    // Signup can "succeed" and still leave the browser holding nothing: the
    // production build marks the session cookie `Secure` and prefixes it
    // `__Host-`, and a browser that did not treat this origin as trustworthy
    // would drop it without complaint. Every spec would then fail at a
    // redirect to /login, which names none of that.
    if (!state.cookies.some((cookie) => cookie.name.endsWith("stockt_session"))) {
      throw new Error(
        `Signup reached /household but no session cookie was stored for ${E2E_BASE_URL}. ` +
          "A production build sets `Secure`, which a browser only accepts from a " +
          "potentially-trustworthy origin — check that the base URL is loopback.",
      );
    }
  } finally {
    await context.close();
  }
}

/**
 * A second session for the same user, for specs that destroy the one they hold.
 *
 * `logOut` deletes the session its own token hashes to and no other, so
 * revoking this one leaves the shared `storageState` working — which matters
 * because the suite runs `fullyParallel`.
 */
async function signInAgain(browser: Browser): Promise<void> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });

  try {
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(E2E_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await reachHousehold(page, "Signing in for the disposable session");

    await context.storageState({ path: E2E_DISPOSABLE_STORAGE_STATE });
  } finally {
    await context.close();
  }
}

export default async function globalSetup(): Promise<void> {
  await startDatabase();
  await applyMigrations();

  await mkdir(dirname(E2E_STORAGE_STATE), { recursive: true });

  const browser = await chromium.launch();

  try {
    await signUp(browser);
    await signInAgain(browser);
  } finally {
    await browser.close();
  }
}
