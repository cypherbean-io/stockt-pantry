import { defineConfig, devices } from "@playwright/test";

import { E2E_SIGNUP_TOKEN } from "./e2e/credentials";
import { E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT, E2E_STORAGE_STATE } from "./e2e/server";

/**
 * The smoke suite (SPEC.md §2 item 13, §5 "Smoke").
 *
 * Local-only and run by hand — SPEC.md §2 puts CI wiring out of scope and
 * `.github/` does not exist in this repo. `src/packaging/packaging.test.ts`
 * carries the guards that a suite nobody runs automatically would otherwise
 * lose silently.
 *
 * This drives a **real production build**, not `next dev`. The standalone
 * `server.js` pins `NODE_ENV=production` itself, which is what flips
 * `secureCookies()` on, which is what gives the session and theme cookies their
 * `Secure` flag and `__Host-` prefix. Those are the flags that actually ship,
 * so those are the ones worth a browser assertion. They survive plain HTTP here
 * only because `127.0.0.1` is a potentially-trustworthy origin and browsers
 * accept `Secure` cookies from one — the single reason `baseURL` is a loopback
 * literal and not `localhost` by another name.
 *
 * The price is a full `next build` per run, which is why this is not part of
 * `npm test`.
 */
export default defineConfig({
  testDir: "./e2e",
  // Specs only. Playwright's default `testMatch` also claims `*.test.ts`, and
  // `e2e/` holds pure unit tests for its own helpers that belong to Vitest —
  // without this they would be loaded by both runners, and `describe`/`it`
  // from Vitest inside a Playwright worker fails in a way that names neither.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,

  // A browser suite against one server and one database: failures should be
  // read, not re-rolled. A retry that goes green is a flake worth a look.
  retries: 0,

  reporter: [
    ["list"],
    // `open: "never"` — a headless machine has nothing to open it with, and a
    // report that hijacks the terminal on every red run is worse than a path.
    ["html", { open: "never" }],
  ],

  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: E2E_BASE_URL,
    // Written by global-setup: one household, signed up through the real form.
    storageState: E2E_STORAGE_STATE,
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    /**
     * Build, then serve **the standalone output** — the same artifact the
     * runtime image runs, for the same reason it runs it.
     *
     * Not `npm start`. `next.config.ts` sets `output: "standalone"`, and
     * against that Next answers `next start` with: *"next start" does not work
     * with "output: standalone" configuration. Use "node
     * .next/standalone/server.js" instead.* It does currently serve anyway, so
     * this is not a crash — it is a suite quietly testing something other than
     * what ships.
     *
     * The copy is not incidental: `next build` leaves `.next/standalone` and
     * `.next/static` in separate places, and `server.js` serves `/_next/static`
     * out of its own directory. Without it the app renders with no stylesheet
     * and no client bundle — which is to say the nav disclosures and the theme
     * toggle would all be dead. The Dockerfile's runtime stage does exactly
     * this copy, two `COPY --from=builder` lines apart. `rm -rf` first because
     * `cp -r` onto an existing directory nests instead of replacing, so the
     * second run of the day would serve the first run's assets.
     */
    command: [
      "npm run build",
      "rm -rf .next/standalone/.next/static",
      "cp -r .next/static .next/standalone/.next/static",
      "node .next/standalone/server.js",
    ].join(" && "),
    // `/login` and not `/`, which is a redirect, and not a route that reads
    // the database — this probe can win the race against global-setup's
    // migration and must not depend on a schema being there yet.
    url: `${E2E_BASE_URL}/login`,
    // Never adopt whatever is already on the port. See `e2e/server.ts`.
    reuseExistingServer: false,
    // A cold `next build` is most of this.
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // Explicit, so a developer's `.env` cannot decide what the suite writes
      // to: `@next/env` only applies a `.env` value for a key that is undefined
      // in the initial environment, and both of these are defined right here.
      DATABASE_URL: E2E_DATABASE_URL,
      HOUSEHOLD_SIGNUP_TOKEN: E2E_SIGNUP_TOKEN,
      // The standalone server takes these from the environment; it has no CLI
      // flags. `HOSTNAME` is loopback rather than the image's 0.0.0.0: a test
      // server holding a signup token should not listen on every interface.
      PORT: String(E2E_PORT),
      HOSTNAME: "127.0.0.1",
    },
  },
});
