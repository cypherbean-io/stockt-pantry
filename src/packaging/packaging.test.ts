import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guard tests for the self-hosting packaging (SPEC.md §3 "Packaging", §6 step 1).
 *
 * These read the repo's Docker files as text rather than parsing YAML, because
 * a YAML parser would be a new dependency for a handful of assertions. They are
 * deliberately narrow: each one encodes a way the packaging has actually been
 * observed to break, not a general style preference.
 *
 * Pure file reads, so this belongs in the `unit` project — it must never need a
 * container to run (see vitest.config.ts).
 */

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function readRepoFile(name: string): string {
  return readFileSync(new URL(name, new URL(`file://${repoRoot}`)), "utf8");
}

const compose = readRepoFile("docker-compose.yml");
const dockerfile = readRepoFile("Dockerfile");
const dockerignore = readRepoFile(".dockerignore");
const gitignore = readRepoFile(".gitignore");
const errorScreen = readRepoFile("src/app/error.tsx");
const playwrightConfig = readRepoFile("playwright.config.ts");
const e2eCredentials = readRepoFile("e2e/credentials.ts");
const e2eServer = readRepoFile("e2e/server.ts");
const dbHarness = readRepoFile("src/db/testing/harness.ts");
const vitestConfig = readRepoFile("vitest.config.ts");

const packageJson = JSON.parse(readRepoFile("package.json")) as {
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
};

/** An ignore file's meaningful lines: no blanks, no comments, no stray indent. */
function ignoreEntries(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * The Dockerfile with comment lines dropped. Assertions about what the build
 * *does* have to run against this — the comments explain why `npx` and bash are
 * avoided, and naming them there would otherwise trip the very checks that
 * enforce it.
 */
const instructions = dockerfile
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

/**
 * A TypeScript source with its comment *lines* dropped, for the same reason
 * `instructions` exists above: these files explain at length what they must
 * never contain, and naming it in a docstring would otherwise trip the very
 * check that enforces it.
 *
 * Line-wise, and not the obvious pair of regexes over the whole text. A
 * `/\/\*[\s\S]*?\*\//` pass cannot tell a comment from a string, and this file
 * asserts on a config containing the glob `"**` + `/*.spec.ts"` — whose `/*`
 * opened a "comment" that swallowed the next forty lines, quietly turning
 * several assertions below into tests of an empty string. `//` has the same
 * problem inside any URL literal.
 *
 * Dropping whole lines is safe against both, because every comment in the
 * files read here is on a line of its own. The cost is that a trailing comment
 * survives and a line of code starting with `*` would not; neither occurs, and
 * each assertion using this is paired with a positive one that fails loudly if
 * the stripper ever eats too much.
 */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const start = line.trimStart();
      return !start.startsWith("//") && !start.startsWith("/*") && !start.startsWith("*");
    })
    .join("\n");
}

const errorScreenCode = stripComments(errorScreen);
const playwrightConfigCode = stripComments(playwrightConfig);

describe("docker-compose.yml", () => {
  it("defines both services SPEC.md §3 requires", () => {
    expect(compose).toMatch(/^\s{2}db:/m);
    expect(compose).toMatch(/^\s{2}app:/m);
  });

  it("holds the app back until Postgres reports healthy", () => {
    // `depends_on` without a condition only waits for the container to be
    // created, which for Postgres is well before it accepts connections.
    expect(compose).toMatch(/condition:\s*service_healthy/);
  });

  it("applies migrations before the app serves traffic", () => {
    // A fresh volume has no schema, so an app that boots straight against it
    //500s on every request. Something must run `drizzle-kit migrate` and
    // finish before the app starts.
    expect(compose).toMatch(/^\s{2}migrate:/m);
    expect(compose).toMatch(/condition:\s*service_completed_successfully/);
  });

  it("points every service at the db service, not the host loopback", () => {
    // 127.0.0.1 inside a container is that container, not Postgres. Matching
    // all occurrences, not the first: a non-global `exec` here only ever
    // inspected `migrate`, leaving the app free to regress unnoticed.
    const urls = [...compose.matchAll(/DATABASE_URL:\s*(\S+)/g)].map((match) => match[1]);

    expect(urls).toHaveLength(2); // migrate and app
    for (const url of urls) {
      expect(url).toContain("@db:5432");
      expect(url).not.toContain("127.0.0.1");
      expect(url).not.toContain("localhost");
    }
  });

  it("ships no default password or signup token", () => {
    // `${VAR:-default}` on either of these would put a working credential in a
    // public repo. POSTGRES_PASSWORD must stay `:?`-required.
    expect(compose).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
    expect(compose).not.toMatch(/\$\{POSTGRES_PASSWORD:-/);
    expect(compose).not.toMatch(/\$\{HOUSEHOLD_SIGNUP_TOKEN:-/);
  });

});

describe("Dockerfile", () => {
  it("does not depend on bash, which the alpine base image lacks", () => {
    // node:*-alpine ships busybox sh only; a `#!/bin/bash` entrypoint fails
    // with a bare "no such file or directory".
    expect(instructions).not.toMatch(/bash/);
  });

  it("only copies build outputs that actually exist", () => {
    // `COPY --from=builder /app/public ./public` fails the build outright when
    // there is no public/ directory in the repo.
    const copiesPublic = /COPY[^\n]*\/app\/public/.test(dockerfile);
    expect(copiesPublic).toBe(existsSync(new URL("public", `file://${repoRoot}`)));
  });

  it("runs every stage as a non-root user", () => {
    // One `USER` per non-builder stage. The builder is throwaway; the migrator
    // holds a live database credential and the runtime serves traffic.
    const stages = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\w+)/gm)].map((m) => m[1]);
    expect(stages).toEqual(["builder", "migrator", "runtime"]);
    expect([...dockerfile.matchAll(/^USER\s+(\w+)/gm)]).toHaveLength(2);
  });

  it("health-checks a path that returns 200, not the redirecting root", () => {
    // `/` is a 307 to /login or /recipes for every visitor (src/app/page.tsx)
    // and node's http.get does not follow redirects, so a check demanding 200
    // from it marks a working app unhealthy forever. The check lives in the
    // Dockerfile, so asserting against the compose file passes vacuously.
    const healthcheck = /HEALTHCHECK[\s\S]*?\n(?=[A-Z]+\s|\n|$)/.exec(dockerfile)?.[0] ?? "";
    expect(healthcheck).not.toBe("");
    expect(healthcheck).toContain("/login");
    expect(healthcheck).not.toMatch(/:3000\/?["']/);
  });

  it("invokes the migration tool from node_modules, not via npx", () => {
    // `npx` silently downloads and runs the registry's latest drizzle-kit when
    // local resolution fails, with a database credential in the environment.
    expect(instructions).not.toMatch(/npx/);
    expect(instructions).toMatch(/node_modules\/\.bin\/drizzle-kit/);
  });
});

describe(".dockerignore", () => {
  const entries = ignoreEntries(dockerignore);

  it("keeps secrets and local state out of the build context at every depth", () => {
    // Docker anchors slash-free patterns at the context root, unlike
    // .gitignore. A bare `.env` therefore lets `deploy/.env` into the image.
    for (const entry of ["**/.env", "**/.env.*", "**/secrets/", "**/*.pem", "**/*.key"]) {
      expect(entries).toContain(entry);
    }
    for (const entry of [".git", "node_modules/"]) {
      expect(entries).toContain(entry);
    }
  });

  it("keeps the migration inputs in the build context", () => {
    // Excluding any of these builds a migrator image that reports "no
    // migrations to apply" and exits 0, leaving the app on an empty schema.
    for (const needed of ["drizzle", "drizzle.config.ts", "src"]) {
      expect(entries).not.toContain(needed);
      expect(entries).not.toContain(`${needed}/`);
    }
  });
});

/**
 * Not packaging, but the same kind of guard and read the same way: a rule about
 * what a file may contain, enforced against its source (SPEC.md §5).
 */
describe("src/app/error.tsx", () => {
  it.each(["error.message", "error.stack", "JSON.stringify(error"])(
    "never reaches for %s",
    (forbidden) => {
      // CLAUDE.md: a `DrizzleQueryError` formats as
      // `Failed query: <sql>\nparams: <bound values>`, and that string now
      // carries password hashes, invite token hashes and whole recipes.
      // `src/db/redact.ts` strips driver errors at the query layer, but this
      // file is the last place an unredacted error from anywhere else could
      // reach a screen — and Next forwards the real message in development,
      // so "production redacts it" is not the guarantee.
      //
      // The source, not the behaviour: `route-states.test.tsx` renders a
      // leaky error and asserts nothing of it appears, which is the stronger
      // check but only covers the shapes it thinks to build. This one covers
      // the spelling, whatever the shape.
      expect(errorScreenCode).not.toContain(forbidden);
    },
  );

  it("is asserting that against code, not against an empty string", () => {
    // The self-test for the comment stripper above. A stripper that returned
    // "" would make all three assertions pass on a file that rendered the
    // stack trace in full.
    expect(errorScreenCode).toContain("retry()");
    expect(errorScreenCode).toContain("digest");
  });

  it("is a Client Component, which Next requires of an error boundary", () => {
    // Without the directive the file is a Server Component and the build
    // fails on `onClick` — a failure whose message does not mention this.
    expect(errorScreen).toMatch(/^"use client";/);
  });
});

/**
 * The Playwright harness (SPEC.md §2 item 13, §4 "Test credentials", §5 Smoke).
 *
 * `npm run test:e2e` is local-only and run by hand, so nothing in CI catches a
 * harness that has quietly stopped pointing where it should. These are the
 * assertions that do — and unlike the smoke specs themselves they are pure file
 * reads, so they run in the `unit` project with no browser and no Docker.
 *
 * Every one of them guards a failure that is silent rather than loud: a suite
 * that signs households into the wrong database still passes, and a committed
 * session cookie still passes.
 */
describe("the Playwright harness", () => {
  it("exposes the smoke suite as `npm run test:e2e`", () => {
    expect(packageJson.scripts["test:e2e"]).toMatch(/\bplaywright test\b/);
  });

  it("runs every check under one `npm run verify`, in SPEC.md §6's order", () => {
    // SPEC.md §6 is a single command from a clean checkout. A `verify` that
    // drops a step still exits 0, which is the whole problem with it.
    const verify = packageJson.scripts["verify"] ?? "";
    const steps = [...verify.matchAll(/npm (?:run )?(\S+)/g)].map((match) => match[1]);

    expect(steps).toEqual(["lint", "typecheck", "test", "test:e2e"]);
  });

  it("keeps the browser test runner out of the runtime image", () => {
    // `dependencies` is what `npm ci --omit=dev` keeps, and the Dockerfile's
    // runtime stage ships `output: "standalone"` built from it. A test runner
    // that pulls browser binaries has no business anywhere near that.
    expect(packageJson.devDependencies).toHaveProperty("@playwright/test");
    expect(packageJson.dependencies).not.toHaveProperty("@playwright/test");
  });

  it("never lets a generated session cookie reach a commit", () => {
    // `e2e/.auth/` holds real `storageState` — a live session cookie for the
    // throwaway database. It is worthless to an attacker and still must not be
    // a tracked file, because the habit is what fails on the day it is not.
    const entries = ignoreEntries(gitignore);

    for (const entry of ["e2e/.auth/", "playwright-report/", "test-results/"]) {
      expect(entries).toContain(entry);
    }
  });

  it("keeps the whole e2e surface out of the Docker build context", () => {
    // Same cookie, one layer further: `.dockerignore` does not inherit
    // `.gitignore`, so an untracked `e2e/.auth/` still lands in an image.
    const entries = ignoreEntries(dockerignore);

    for (const entry of ["e2e/", "playwright.config.ts", "playwright-report/", "test-results/"]) {
      expect(entries).toContain(entry);
    }
  });

  it("generates every credential instead of committing one", () => {
    // SPEC.md §4: none of these is written into a file. The same call
    // `docker-compose.test.yml` makes when it picks trust authentication
    // rather than inventing a password to commit.
    //
    // Structural, not a search for suspicious-looking strings: each exported
    // credential must come from `generated()`, and `generated()` must be the
    // thing that reaches for randomness. Someone "simplifying" one into a
    // constant fails here however they choose to spell it.
    expect(e2eCredentials).toMatch(/function generated\([^)]*\)[\s\S]*?randomUUID\(\)/);

    for (const exported of ["E2E_SIGNUP_TOKEN", "E2E_PASSWORD", "E2E_EMAIL"]) {
      expect(e2eCredentials).toMatch(new RegExp(`export const ${exported} = generated\\(`));
    }

    // And the app under test is handed that generated value, not a literal.
    expect(playwrightConfigCode).toMatch(/HOUSEHOLD_SIGNUP_TOKEN:\s*E2E_SIGNUP_TOKEN/);
  });

  it("defaults to the same throwaway Postgres the db suite uses", () => {
    // Both harnesses must name the same database, so `npm run db:test:down`
    // tears down the one that was actually used — which is why this compares
    // the two strings rather than asserting one literal twice.
    //
    // This covers the *default* only. What a run resolves to after
    // `TEST_DATABASE_URL` is checked at runtime by `throwawayDatabaseUrl`,
    // which `e2e/server.test.ts` covers properly; asserting source text could
    // never say anything about an environment variable.
    const url = /postgres:\/\/\S+?\/\w+/;
    const fromE2e = url.exec(e2eServer)?.[0];
    const fromDbSuite = url.exec(dbHarness)?.[0];

    expect(fromE2e).toBeDefined();
    expect(fromE2e).toBe(fromDbSuite);
    expect(fromE2e).toContain(":55432/");
    expect(fromE2e).toMatch(/_test$/);
  });

  it("validates the resolved database URL rather than trusting the default", () => {
    // `global-setup.ts` runs `drizzle-kit migrate`, which applies this repo's
    // DDL — `ALTER` and `DROP` included — to whatever it is pointed at, and
    // `TEST_DATABASE_URL` overrides the literal above. The behaviour is
    // covered by `e2e/server.test.ts`; what is guarded here is that the
    // override still goes through the check at all, because deleting the call
    // would leave every one of those tests passing.
    expect(e2eServer).toMatch(
      /E2E_DATABASE_URL = throwawayDatabaseUrl\(\s*process\.env\.TEST_DATABASE_URL/,
    );
  });

  it("serves its own build rather than reusing whatever is on port 3000", () => {
    // `reuseExistingServer` against a running dev server is the quiet failure
    // this guards: the suite would drive a different build, pointed at a
    // different database, with no signup token configured — and report on it
    // as if it were the thing under test.
    expect(playwrightConfigCode).toMatch(/reuseExistingServer:\s*false/);

    const port = /E2E_PORT\s*=\s*(\d+)/.exec(e2eServer)?.[1];
    expect(port).toBeDefined();
    expect(port).not.toBe("3000");
  });

  it("smoke-tests the standalone output, which is the artifact the image runs", () => {
    // SPEC.md §5 says `npm run build && npm start`, and Next answers that with
    // `"next start" does not work with "output: standalone" configuration`.
    // It serves anyway today, so the regression is silent: a suite testing a
    // build that is not the one shipped. The static copy is half of it —
    // `server.js` serves /_next/static from its own directory, and without it
    // the app comes up with no stylesheet and no client bundle, which would
    // take the nav disclosure and the theme toggle with it.
    expect(playwrightConfigCode).toContain("node .next/standalone/server.js");
    expect(playwrightConfigCode).toContain("cp -r .next/static .next/standalone/.next/static");
    expect(playwrightConfigCode).not.toMatch(/\bnpm start\b/);
  });

  it("serves the build from loopback, which is what keeps a Secure cookie", () => {
    // `next start` means NODE_ENV=production, which means `secureCookies()`
    // is true, which means `__Host-stockt_session; Secure`. A browser only
    // keeps a Secure cookie from a potentially-trustworthy origin, and over
    // plain HTTP that is loopback and nothing else. Point this at a LAN
    // address or a hostname and every spec fails at a redirect to /login
    // having never been told why.
    expect(e2eServer).toContain("http://127.0.0.1:");
  });

  it("splits the two runners by suffix, so neither loads the other's files", () => {
    // `e2e/` holds both: `*.spec.ts` for Playwright and `*.test.ts` for the
    // pure helpers Vitest owns. Each runner would otherwise claim both —
    // Playwright's default `testMatch` covers `*.test.ts`, and a Vitest
    // `describe` inside a Playwright worker fails in a way that names neither
    // file. So: Vitest collects only `*.test.ts(x)`, Playwright only `*.spec`.
    const globs = [...vitestConfig.matchAll(/include:\s*\[([^\]]*)\]/g)].flatMap((match) =>
      [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((quoted) => quoted[1] ?? ""),
    );

    expect(globs.length).toBeGreaterThan(0);
    for (const glob of globs) {
      expect(glob).toMatch(/\.test\.tsx?$/);
    }

    expect(playwrightConfigCode).toMatch(/testMatch:\s*["']\*\*\/\*\.spec\.ts["']/);
  });
});
