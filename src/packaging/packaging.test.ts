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
  const entries = dockerignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

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
