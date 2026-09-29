import { describe, expect, it } from "vitest";

import { throwawayDatabaseUrl } from "./server";

/**
 * The backstop in front of the smoke suite's database (SPEC.md §5).
 *
 * A Vitest test living in `e2e/`, which is deliberate: this is pure logic and
 * has no business starting a browser or a build to be checked. The `*.test.ts`
 * suffix is what routes it here rather than to Playwright — see `testMatch` in
 * `playwright.config.ts`.
 *
 * Worth testing properly rather than asserting on the source text, because the
 * thing it prevents is `drizzle-kit migrate` applying this repo's DDL to a
 * database someone cares about.
 */

const THROWAWAY = "postgres://postgres@127.0.0.1:55432/stockt_test";

describe("throwawayDatabaseUrl", () => {
  it("accepts a database whose name ends in _test", () => {
    expect(throwawayDatabaseUrl(THROWAWAY)).toBe(THROWAWAY);
  });

  it("accepts one on any host and port, since the name is the guarantee", () => {
    const remote = "postgres://someone:pw@db.example:5432/anything_test";
    expect(throwawayDatabaseUrl(remote)).toBe(remote);
  });

  it.each([
    ["the compose dev database", "postgres://stockt:pw@127.0.0.1:5432/stockt"],
    ["a production-looking one", "postgres://app:pw@db.internal:5432/stockt_production"],
    ["a name merely containing _test", "postgres://postgres@127.0.0.1:55432/stockt_test_backup"],
    ["no database at all", "postgres://postgres@127.0.0.1:55432"],
  ])("refuses %s", (_case, url) => {
    expect(() => throwawayDatabaseUrl(url)).toThrow(/only operates on a database/);
  });

  it("names the database it refused, so the message is actionable", () => {
    expect(() => throwawayDatabaseUrl("postgres://postgres@127.0.0.1:5432/stockt")).toThrow(
      /"stockt"/,
    );
  });

  it("never puts the connection string in the error it throws for a bad URL", () => {
    // Node's ERR_INVALID_URL TypeError carries the whole string — password and
    // all — in an own enumerable `input` property, and Next's default handler
    // prints whatever escapes. CLAUDE.md: rethrowing one counts as logging it.
    const malformed = "not a url://hunter2@nowhere";

    expect(() => throwawayDatabaseUrl(malformed)).toThrow(/valid connection URL/);

    try {
      throwawayDatabaseUrl(malformed);
      expect.unreachable("should have thrown");
    } catch (error) {
      const thrown = error as Error;
      expect(thrown.message).not.toContain("hunter2");
      // No `cause` either — attaching the original would carry `input` along
      // with it and put the credential right back in the chain.
      expect(thrown.cause).toBeUndefined();
    }
  });
});
