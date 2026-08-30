import { describe, expect, it } from "vitest";

import { isUniqueViolation, redacted } from "./redact";

/**
 * CLAUDE.md: never log a Drizzle error's `.message`, and rethrowing one counts
 * as logging it — Next's default handler prints whatever escapes, cause chain
 * included. `DrizzleQueryError` formats as `Failed query: <sql>\nparams: <bound
 * values>`, and for these queries the bound values are password hashes, invite
 * token hashes, and whole recipes (SPEC.md §4 forbids logging the last of
 * those too).
 */

/** Shaped like what Drizzle throws when postgres.js rejects a statement. */
function drizzleError(cause: { code: string; constraint_name?: string }): Error {
  return Object.assign(
    new Error(
      'Failed query: insert into "recipe_ingredient" ...\nparams: hunter2,scrypt$secret-hash',
    ),
    { cause },
  );
}

describe("redacted", () => {
  it("keeps the SQLSTATE and the constraint, which is all a caller can act on", () => {
    const error = redacted("Recipe query", drizzleError({ code: "23505", constraint_name: "x_y" }));

    expect(error.message).toContain("23505");
    expect(error.message).toContain("x_y");
    expect(error.message).toContain("Recipe query");
  });

  it("drops the bound parameters from the message", () => {
    const error = redacted("Recipe query", drizzleError({ code: "23505" }));

    expect(error.message).not.toContain("hunter2");
    expect(error.message).not.toContain("scrypt$secret-hash");
    expect(error.message).not.toContain("Failed query");
  });

  it("does not carry the original along as a cause", () => {
    // Node prints the whole cause chain when it reports an unhandled error, so
    // attaching the original would put the parameters back in the log.
    const error = redacted("Recipe query", drizzleError({ code: "23505" }));

    expect(error.cause).toBeUndefined();
  });

  it("still produces something throwable when the error carries no SQLSTATE", () => {
    const error = redacted("Recipe query", new Error("connection terminated"));

    expect(error.message).toContain("unknown");
    expect(error.message).not.toContain("connection terminated");
  });
});

describe("isUniqueViolation", () => {
  it("matches on the SQLSTATE and constraint rather than the message text", () => {
    expect(isUniqueViolation(drizzleError({ code: "23505", constraint_name: "x_y" }), "x_y")).toBe(
      true,
    );
  });

  it("does not confuse a different constraint for the one asked about", () => {
    expect(
      isUniqueViolation(drizzleError({ code: "23505", constraint_name: "other" }), "x_y"),
    ).toBe(false);
  });

  it("does not treat a check violation as a unique violation", () => {
    expect(isUniqueViolation(drizzleError({ code: "23514", constraint_name: "x_y" }), "x_y")).toBe(
      false,
    );
  });
});
