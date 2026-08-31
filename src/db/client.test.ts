import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `DATABASE_URL` is the one credential the app holds in a variable, and
 * `postgres()` parses it with `new URL()`. Node's `ERR_INVALID_URL` `TypeError`
 * carries the whole offending string in an own enumerable `input` property, so
 * the default error printer dumps the password — the same class of leak
 * `redact.ts` exists to stop for driver errors.
 *
 * This is not a contrived password: `.env.example` points operators at
 * `openssl rand -base64 32`, and base64's alphabet includes `/`.
 *
 * Parsing fails before any socket is opened, so this stays in the `unit`
 * project — it never reaches a database.
 */

const PASSWORD = "s3cret/with?reserved#chars";
const URL_WITH_RESERVED_CHARS = `postgres://stockt:${PASSWORD}@db:5432/stockt`;

const original = process.env.DATABASE_URL;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (original === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original;
});

describe("getDb", () => {
  it("still refuses an unset DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    const { getDb } = await import("./client");
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });

  it("does not leak the password when the connection string will not parse", async () => {
    process.env.DATABASE_URL = URL_WITH_RESERVED_CHARS;
    const { getDb } = await import("./client");

    let thrown: unknown;
    expect(() => {
      try {
        getDb();
      } catch (error) {
        thrown = error;
        throw error;
      }
    }).toThrow();

    // `inspect` with a depth is what Node's unhandled-error printer does, so it
    // is the honest check: not just `.message`, but every enumerable property
    // and the whole cause chain.
    const printed = inspect(thrown, { depth: 5 });
    expect(printed).not.toContain(PASSWORD);
    expect(printed).not.toContain("s3cret");
    expect(printed).not.toContain(URL_WITH_RESERVED_CHARS);
    expect(thrown).not.toHaveProperty("input");
    expect((thrown as { cause?: unknown }).cause).toBeUndefined();

    // Still has to say something actionable.
    expect((thrown as Error).message).toMatch(/DATABASE_URL/);
  });
});
