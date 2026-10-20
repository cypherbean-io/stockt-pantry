import { beforeEach, describe, expect, it } from "vitest";

import { loginThrottle, session } from "./schema";
import { recordLoginAttempt } from "./queries/auth";
import { resetDatabase, testDb } from "./testing/harness";
import { logIn, signUpHousehold, type AuthResult, type IssuedSession } from "@/lib/auth/service";
import type { AuthEnv } from "@/lib/auth/env";
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, loginWindowCutoff } from "@/lib/auth/throttle";

/**
 * Login throttling against a real Postgres.
 *
 * The counter is a row, not process memory, so what these pin down is mostly
 * what the row does: that it is keyed by the address whether or not an account
 * has it, that a burst of simultaneous attempts cannot all read the same count,
 * and that what is stored is not the address itself.
 */

const db = testDb();

const SIGNUP_TOKEN = "operator-held-signup-token";
const SIGNUP_ENV: AuthEnv = { HOUSEHOLD_SIGNUP_TOKEN: SIGNUP_TOKEN };

const T0 = new Date("2026-03-01T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const OWNER = "owner@alpha.example";
const PASSWORD = "a sufficiently long passphrase";
const WRONG = "not the passphrase at all";

const THROTTLED = { ok: false, error: "too-many-attempts" } as const;
const INVALID = { ok: false, error: "invalid-credentials" } as const;

/** Postgres rejects a NUL in a text value outright: SQLSTATE 22021. */
const MARKER = "ADDRESS-MARKER-NOT-A-CREDENTIAL";
const NUL_EMAIL = `${MARKER}${"\u0000"}@example.test`;

async function signUpOwner(email: string = OWNER): Promise<void> {
  const result = await signUpHousehold(
    { householdName: "Alpha", email, password: PASSWORD, signupToken: SIGNUP_TOKEN },
    { now: T0, env: SIGNUP_ENV },
  );
  if (!result.ok) throw new Error(`signup should have succeeded, got ${result.error}`);
}

/** One after another, so each sees the count the last one left. */
async function attempts(
  email: string,
  count: number,
  password: string = WRONG,
  now: Date = T0,
): Promise<AuthResult<IssuedSession>[]> {
  const results: AuthResult<IssuedSession>[] = [];
  for (let i = 0; i < count; i += 1) {
    results.push(await logIn({ email, password }, { now }));
  }
  return results;
}

async function rejection(query: Promise<unknown>): Promise<Error> {
  try {
    await query;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the query to be rejected, but it succeeded");
}

beforeEach(async () => {
  await resetDatabase();
});

describe("login throttling", () => {
  it("refuses the attempt after the limit even when the password is right", async () => {
    await signUpOwner();
    const sessionsBefore = (await db.select().from(session)).length;

    const failures = await attempts(OWNER, LOGIN_MAX_ATTEMPTS);
    const next = await logIn({ email: OWNER, password: PASSWORD }, { now: T0 });

    expect(failures).toEqual(Array(LOGIN_MAX_ATTEMPTS).fill(INVALID));
    expect(next).toEqual(THROTTLED);
    expect(await db.select().from(session)).toHaveLength(sessionsBefore);
  });

  it("throttles an address with no account exactly as it throttles one with an account", async () => {
    // An address that only ever locks once it belongs to someone would answer
    // "does this account exist?" in eleven requests.
    await signUpOwner();

    const known = await attempts(OWNER, LOGIN_MAX_ATTEMPTS + 1);
    const unknown = await attempts("nobody@alpha.example", LOGIN_MAX_ATTEMPTS + 1);

    expect(unknown).toEqual(known);
    expect(unknown.at(-1)).toEqual(THROTTLED);
  });

  it("lets the address try again once the window has run out", async () => {
    await signUpOwner();
    await attempts(OWNER, LOGIN_MAX_ATTEMPTS + 1);

    const later = await logIn({ email: OWNER, password: PASSWORD }, { now: at(LOGIN_WINDOW_MS) });

    expect(later.ok).toBe(true);
  });

  it("still refuses a millisecond before the window runs out", async () => {
    await signUpOwner();
    await attempts(OWNER, LOGIN_MAX_ATTEMPTS);

    const early = await logIn(
      { email: OWNER, password: PASSWORD },
      { now: at(LOGIN_WINDOW_MS - 1) },
    );

    expect(early).toEqual(THROTTLED);
  });

  it("does not stretch the window for attempts made while it is shut", async () => {
    // Fixed, not sliding: hammering a locked address keeps it locked only
    // until the window that is already open runs out.
    await signUpOwner();
    await attempts(OWNER, LOGIN_MAX_ATTEMPTS);
    await attempts(OWNER, 5, WRONG, at(LOGIN_WINDOW_MS - 1));

    const later = await logIn({ email: OWNER, password: PASSWORD }, { now: at(LOGIN_WINDOW_MS) });

    expect(later.ok).toBe(true);
  });

  it("counts every spelling of an address that signs in to the same account", async () => {
    // `logIn` trims, and the lookup lowers in SQL; a key that did neither
    // would hand out a fresh budget per capitalisation.
    await signUpOwner();
    const spellings = ["OWNER@ALPHA.EXAMPLE", " Owner@Alpha.Example ", "owner@ALPHA.example"];

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      await logIn({ email: spellings[i % spellings.length], password: WRONG }, { now: T0 });
    }

    expect(await logIn({ email: OWNER, password: PASSWORD }, { now: T0 })).toEqual(THROTTLED);
  });

  it("keeps counting through a successful login", async () => {
    // Only a real account can sign in, so a count that dropped back to zero
    // would tell whoever was watching it that the address exists — and that
    // its owner had just been there.
    await signUpOwner();
    await attempts(OWNER, LOGIN_MAX_ATTEMPTS - 1);
    const success = await logIn({ email: OWNER, password: PASSWORD }, { now: T0 });

    const again = await logIn({ email: OWNER, password: PASSWORD }, { now: T0 });

    expect(success.ok).toBe(true);
    expect(again).toEqual(THROTTLED);
  });

  it("leaves other addresses alone while one is locked", async () => {
    await signUpOwner(OWNER);
    await signUpOwner("second@alpha.example");
    await attempts(OWNER, LOGIN_MAX_ATTEMPTS + 1);

    const other = await logIn({ email: "second@alpha.example", password: PASSWORD }, { now: T0 });

    expect(other.ok).toBe(true);
  });

  it("lets no more than the limit through when the attempts arrive all at once", async () => {
    // A read-then-check-then-write counter lets a parallel burst all read the
    // same count. Counting before the password check, in one statement, is
    // what makes the row lock serialise them.
    await signUpOwner();

    const burst = await Promise.all(
      Array.from({ length: LOGIN_MAX_ATTEMPTS + 5 }, () =>
        logIn({ email: OWNER, password: WRONG }, { now: T0 }),
      ),
    );

    expect(burst.filter((r) => !r.ok && r.error === "invalid-credentials")).toHaveLength(
      LOGIN_MAX_ATTEMPTS,
    );
    expect(burst.filter((r) => !r.ok && r.error === "too-many-attempts")).toHaveLength(5);
  });

  it("does not spend the budget on a submission rejected before the password check", async () => {
    await signUpOwner();
    await attempts(OWNER, LOGIN_MAX_ATTEMPTS * 2, "");

    const real = await logIn({ email: OWNER, password: PASSWORD }, { now: T0 });

    expect(real.ok).toBe(true);
  });

  it("stores nothing for an input no account can have", async () => {
    // A password typed into the email field, more often than not. It has no
    // `@`, so it cannot be anyone's address and there is nothing to count.
    await logIn({ email: "correct horse battery staple", password: WRONG }, { now: T0 });

    expect(await db.select().from(loginThrottle)).toHaveLength(0);
  });

  it("answers an address carrying a NUL as bad credentials, not a server error", async () => {
    // Postgres would reject the NUL with SQLSTATE 22021 — a 500 to anyone who
    // can post the form. No account can hold one, so it never needs to get
    // that far.
    const result = await logIn({ email: NUL_EMAIL, password: WRONG }, { now: T0 });

    expect(result).toEqual(INVALID);
  });

  it("clears out the rows of windows that have run out", async () => {
    // Otherwise every address ever typed stays in the table, and anyone can
    // grow it by typing new ones.
    await logIn({ email: OWNER, password: WRONG }, { now: T0 });
    await logIn({ email: "other@alpha.example", password: WRONG }, { now: at(LOGIN_WINDOW_MS) });

    const rows = await db.select().from(loginThrottle);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.windowStartedAt).toEqual(at(LOGIN_WINDOW_MS));
  });

  it("stores a hash of the address, not the address", async () => {
    // Whatever is typed into the email field lands here — including, now and
    // then, someone's password.
    await logIn({ email: OWNER, password: WRONG }, { now: T0 });

    const rows = await db.select().from(loginThrottle);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("alpha.example");
  });
});

describe("login throttle errors", () => {
  /**
   * The bound value is whatever was posted as an address, by someone not yet
   * signed in. CLAUDE.md: a rethrown driver error prints its parameters.
   */
  it("does not carry the address out of a failure to record an attempt", async () => {
    const error = await rejection(
      recordLoginAttempt(NUL_EMAIL, { now: T0, windowCutoff: loginWindowCutoff(T0) }),
    );

    expect(error.message).not.toContain(MARKER);
    expect(error.message).not.toContain("params:");
    expect(error.message).toContain("22021");
  });
});
