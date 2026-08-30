import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { invite, session, user } from "./schema";
import { scopeForSession } from "./scope";
import { listInvites } from "./queries/invites";
import { resetDatabase, testDb } from "./testing/harness";
import {
  authenticate,
  issueInvite,
  joinWithInvite,
  logIn,
  logOut,
  signUpHousehold,
} from "@/lib/auth/service";
import type { AuthEnv } from "@/lib/auth/env";
import { hashToken } from "@/lib/auth/token";
import {
  createHouseholdWithOwner,
  findUserCredentialsByEmail,
  redeemInviteIntoNewUser,
} from "./queries/auth";

/**
 * The auth slice end to end against a real Postgres (SPEC.md §5,
 * "Auth/invite flow").
 *
 * This lives under `src/db/` rather than next to the service it exercises
 * because several of the assertions are about what is *in the row* — that a
 * session stores a hash and not a replayable token, that a rejected signup
 * leaves no household behind. Those need the raw tables, which the lint rule in
 * `eslint.config.mjs` deliberately keeps out of reach everywhere else.
 */

const db = testDb();

const SIGNUP_TOKEN = "operator-held-signup-token";
const SIGNUP_ENV: AuthEnv = { HOUSEHOLD_SIGNUP_TOKEN: SIGNUP_TOKEN };

/** Fixed instants, so nothing here depends on the wall clock. */
const T0 = new Date("2026-03-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const after = (days: number) => new Date(T0.getTime() + days * DAY);

const PASSWORD = "a sufficiently long passphrase";

/**
 * Provokes SQLSTATE 22021 — Postgres cannot store a NUL in a text column, and
 * rejects the whole statement. `credentials.ts` refuses this shape well before
 * the query layer; these tests call the query layer directly.
 */
const NUL_EMAIL = `a${"\u0000"}b@example.test`;

/** The error as it escapes, not its unwrapped driver cause. */
async function rejection(query: Promise<unknown>): Promise<Error> {
  try {
    await query;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the query to be rejected, but it succeeded");
}

async function signUpOwner(
  householdName: string,
  email: string,
  now: Date = T0,
): Promise<{ userId: string; householdId: string; token: string }> {
  const result = await signUpHousehold(
    { householdName, email, password: PASSWORD, signupToken: SIGNUP_TOKEN },
    { now, env: SIGNUP_ENV },
  );
  if (!result.ok) throw new Error(`signup should have succeeded, got ${result.error}`);
  return result.value;
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("household signup", () => {
  it("creates the household, its first member, and a live session", async () => {
    const issued = await signUpOwner("Alpha Kitchen", "owner@alpha.example");

    const verified = await authenticate(issued.token, { now: T0 });
    expect(verified?.userId).toBe(issued.userId);
    expect(verified?.householdId).toBe(issued.householdId);
    expect(verified?.email).toBe("owner@alpha.example");
  });

  it("refuses a wrong deployment signup token", async () => {
    const result = await signUpHousehold(
      {
        householdName: "Alpha",
        email: "owner@alpha.example",
        password: PASSWORD,
        signupToken: "guessed",
      },
      { now: T0, env: SIGNUP_ENV },
    );

    expect(result).toEqual({ ok: false, error: "invalid-signup-token" });
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("refuses every signup when the deployment configured no token", async () => {
    // SPEC.md §2 puts open signup out of scope; an unconfigured deployment must
    // not default to accepting anything.
    const result = await signUpHousehold(
      { householdName: "Alpha", email: "owner@alpha.example", password: PASSWORD, signupToken: "" },
      { now: T0, env: {} },
    );

    expect(result).toEqual({ ok: false, error: "invalid-signup-token" });
  });

  it("reports bad input as field errors without creating anything", async () => {
    const result = await signUpHousehold(
      { householdName: "", email: "not-an-address", password: "short", signupToken: SIGNUP_TOKEN },
      { now: T0, env: SIGNUP_ENV },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.fieldErrors ?? {}).sort()).toEqual([
      "email",
      "householdName",
      "password",
    ]);
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("leaves no orphan household behind when the email is already taken", async () => {
    await signUpOwner("Alpha", "owner@alpha.example");

    const result = await signUpHousehold(
      {
        householdName: "Beta",
        email: "owner@alpha.example",
        password: PASSWORD,
        signupToken: SIGNUP_TOKEN,
      },
      { now: T0, env: SIGNUP_ENV },
    );

    expect(result).toEqual({ ok: false, error: "email-taken" });
    // The household insert and the user insert are one transaction, so a
    // rejected user must take the half-made household with it.
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("stores the address lowercased so logging in is case-insensitive", async () => {
    // schema.ts pins CHECK (email = lower(email)); the lowering has to happen
    // in SQL, because JS toLowerCase() disagrees with Postgres on U+0130.
    await signUpOwner("Alpha", "Owner@Alpha.Example");

    const [row] = await db.select().from(user);
    expect(row?.email).toBe("owner@alpha.example");

    const login = await logIn({ email: "OWNER@ALPHA.EXAMPLE", password: PASSWORD }, { now: T0 });
    expect(login.ok).toBe(true);
  });

  it("never stores the password itself", async () => {
    await signUpOwner("Alpha", "owner@alpha.example");

    const [row] = await db.select().from(user);
    expect(row?.passwordHash).not.toContain(PASSWORD);
    expect(row?.passwordHash).toMatch(/^scrypt\$/);
  });
});

describe("login", () => {
  it("issues a session for the right password", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");

    const result = await logIn({ email: "owner@alpha.example", password: PASSWORD }, { now: T0 });

    expect(result.ok && result.value.userId).toBe(owner.userId);
    expect(result.ok && result.value.householdId).toBe(owner.householdId);
  });

  it("rejects the wrong password and creates no session", async () => {
    await signUpOwner("Alpha", "owner@alpha.example");
    const sessionsBefore = (await db.select().from(session)).length;

    const result = await logIn(
      { email: "owner@alpha.example", password: "the wrong passphrase entirely" },
      { now: T0 },
    );

    expect(result).toEqual({ ok: false, error: "invalid-credentials" });
    expect(await db.select().from(session)).toHaveLength(sessionsBefore);
  });

  it("answers an unknown address exactly as it answers a wrong password", async () => {
    // Distinguishable errors turn the login form into an account-enumeration
    // oracle.
    await signUpOwner("Alpha", "owner@alpha.example");

    const unknown = await logIn({ email: "nobody@alpha.example", password: PASSWORD }, { now: T0 });
    const wrong = await logIn({ email: "owner@alpha.example", password: "not it at all" }, { now: T0 });

    expect(unknown).toEqual(wrong);
  });

  it("mints a fresh token per login rather than reissuing the old one", async () => {
    const first = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await logIn({ email: "owner@alpha.example", password: PASSWORD }, { now: T0 });

    expect(second.ok && second.value.token).not.toBe(first.token);
    // Both remain valid: signing in on a second device does not evict the first.
    expect(await authenticate(first.token, { now: T0 })).toBeDefined();
  });
});

describe("invites", () => {
  it("puts the joining user in the inviting household, not a new one", async () => {
    // SPEC.md §6 step 2: both members land in the same pantry.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token } = await issueInvite(scope, owner.userId, { now: T0 });

    const joined = await joinWithInvite(
      { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
      { now: after(1) },
    );

    expect(joined.ok && joined.value.householdId).toBe(owner.householdId);
    expect(joined.ok && joined.value.userId).not.toBe(owner.userId);
  });

  it("works exactly once", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token } = await issueInvite(scope, owner.userId, { now: T0 });

    const first = await joinWithInvite(
      { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
      { now: after(1) },
    );
    const second = await joinWithInvite(
      { inviteToken: token, email: "third@alpha.example", password: PASSWORD },
      { now: after(1) },
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "invite-invalid" });
    expect(await db.select().from(user)).toHaveLength(2);
  });

  it("marks itself used at the moment it is redeemed", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token, inviteId } = await issueInvite(scope, owner.userId, { now: T0 });

    expect((await listInvites(scope)).find((row) => row.id === inviteId)?.usedAt).toBeNull();

    await joinWithInvite(
      { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
      { now: after(1) },
    );

    expect((await listInvites(scope)).find((row) => row.id === inviteId)?.usedAt).not.toBeNull();
  });

  it("is rejected once it has expired", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token, expiresAt } = await issueInvite(scope, owner.userId, { now: T0 });

    const late = new Date(expiresAt.getTime() + 1000);
    const result = await joinWithInvite(
      { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
      { now: late },
    );

    expect(result).toEqual({ ok: false, error: "invite-invalid" });
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("rejects a token that was never issued", async () => {
    await signUpOwner("Alpha", "owner@alpha.example");

    const result = await joinWithInvite(
      { inviteToken: "made-up-token", email: "second@alpha.example", password: PASSWORD },
      { now: T0 },
    );

    expect(result).toEqual({ ok: false, error: "invite-invalid" });
  });

  it("is not consumed by an attempt that failed on a duplicate email", async () => {
    // Burning the invite on a typo would leave the invitee stuck with a link
    // that no longer works and no account.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token } = await issueInvite(scope, owner.userId, { now: T0 });

    const clash = await joinWithInvite(
      { inviteToken: token, email: "owner@alpha.example", password: PASSWORD },
      { now: after(1) },
    );
    expect(clash).toEqual({ ok: false, error: "email-taken" });

    const retry = await joinWithInvite(
      { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
      { now: after(1) },
    );
    expect(retry.ok).toBe(true);
  });

  it("lets exactly one of two simultaneous redemptions through", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token } = await issueInvite(scope, owner.userId, { now: T0 });

    const results = await Promise.all([
      joinWithInvite(
        { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
        { now: after(1) },
      ),
      joinWithInvite(
        { inviteToken: token, email: "third@alpha.example", password: PASSWORD },
        { now: after(1) },
      ),
    ]);

    // "Single-use" has to hold against a race, not just against a second
    // sequential attempt — the claim is a conditional UPDATE, not read-then-write.
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.select().from(user)).toHaveLength(2);
  });

  it("stores only the hash of the token it hands out", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token } = await issueInvite(scope, owner.userId, { now: T0 });

    const [row] = await db.select().from(invite);
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).toBe(hashToken(token));
  });

  it("records who issued it, within the issuing household", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    await issueInvite(scope, owner.userId, { now: T0 });

    const [row] = await listInvites(scope);
    expect(row?.householdId).toBe(owner.householdId);
    expect(row?.createdBy).toBe(owner.userId);
  });
});

describe("unexpected database errors", () => {
  /**
   * CLAUDE.md: a `DrizzleQueryError` stringifies as
   * `Failed query: <sql>\nparams: <bound values>`, and on these queries the
   * bound values are password hashes. Rethrowing one is the same as logging it,
   * because whatever catches it upstream — Next's default error handler — will
   * print it.
   *
   * A NUL byte is the cheapest way to provoke a driver error that is *not* the
   * unique violation these functions know how to handle: Postgres rejects the
   * whole statement with SQLSTATE 22021. `credentials.ts` refuses one long
   * before this point, so reaching it means calling the query layer directly.
   */
  const MARKER = "DIGEST-MARKER-NOT-A-CREDENTIAL";

  it("does not carry bound parameters out of a signup failure", async () => {
    const error = await rejection(
      createHouseholdWithOwner({
        householdName: "Nul",
        email: NUL_EMAIL,
        passwordHash: `scrypt$16384$8$1$c2FsdA$${MARKER}`,
      }),
    );

    expect(error.message).not.toContain(MARKER);
    expect(error.message).not.toContain("params:");
    // The SQLSTATE still has to survive, or the failure is undiagnosable.
    expect(error.message).toContain("22021");
  });

  it("does not carry bound parameters out of an invite redemption failure", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token } = await issueInvite(scope, owner.userId, { now: T0 });

    const error = await rejection(
      redeemInviteIntoNewUser({
        tokenHash: hashToken(token),
        email: NUL_EMAIL,
        passwordHash: `scrypt$16384$8$1$c2FsdA$${MARKER}`,
        now: after(1),
      }),
    );

    expect(error.message).not.toContain(MARKER);
    expect(error.message).not.toContain("params:");
  });

  it("does not carry bound parameters out of a credential lookup", async () => {
    // The one on the unauthenticated path: `logIn` reaches this with whatever
    // address was posted.
    const error = await rejection(findUserCredentialsByEmail(NUL_EMAIL));

    expect(error.message).not.toContain("params:");
    expect(error.message).toContain("22021");
  });

  it("keeps the rolled-back invite usable after a rejected redemption", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const scope = scopeForSession((await authenticate(owner.token, { now: T0 }))!);
    const { token } = await issueInvite(scope, owner.userId, { now: T0 });

    await rejection(
      redeemInviteIntoNewUser({
        tokenHash: hashToken(token),
        email: NUL_EMAIL,
        passwordHash: "scrypt$16384$8$1$c2FsdA$aaaa",
        now: after(1),
      }),
    );

    const retry = await joinWithInvite(
      { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
      { now: after(1) },
    );
    expect(retry.ok).toBe(true);
  });
});

describe("sessions", () => {
  it("stores only the hash of the token in the cookie", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");

    const [row] = await db.select().from(session);
    expect(row?.tokenHash).not.toBe(owner.token);
    expect(row?.tokenHash).toBe(hashToken(owner.token));
  });

  it("stops resolving once it has expired", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");

    expect(await authenticate(owner.token, { now: after(29) })).toBeDefined();
    expect(await authenticate(owner.token, { now: after(31) })).toBeUndefined();
  });

  it.each([
    ["an unknown token", "not-a-real-token"],
    ["an empty token", ""],
    ["no cookie at all", undefined],
  ])("resolves nothing for %s", async (_label, token) => {
    await signUpOwner("Alpha", "owner@alpha.example");

    expect(await authenticate(token, { now: T0 })).toBeUndefined();
  });

  it("is revoked server-side on logout, not just cleared from the browser", async () => {
    // Deleting only the cookie would leave a token that still works if it was
    // ever captured.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");

    await logOut(owner.token);

    expect(await db.select().from(session)).toHaveLength(0);
    expect(await authenticate(owner.token, { now: T0 })).toBeUndefined();
  });

  it("logging out of one device leaves the other signed in", async () => {
    const first = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await logIn({ email: "owner@alpha.example", password: PASSWORD }, { now: T0 });

    await logOut(first.token);

    expect(await authenticate(first.token, { now: T0 })).toBeUndefined();
    expect(second.ok && (await authenticate(second.value.token, { now: T0 }))).toBeDefined();
  });

  it("yields a scope for the household it belongs to and no other", async () => {
    const alpha = await signUpOwner("Alpha", "owner@alpha.example");
    const beta = await signUpOwner("Beta", "owner@beta.example");

    const scopeA = scopeForSession((await authenticate(alpha.token, { now: T0 }))!);
    const scopeB = scopeForSession((await authenticate(beta.token, { now: T0 }))!);

    expect(scopeA.householdId).toBe(alpha.householdId);
    expect(scopeB.householdId).toBe(beta.householdId);
    expect(scopeA.householdId).not.toBe(scopeB.householdId);
  });

  it("goes away with the user it belongs to", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");

    await db.delete(user);

    expect(await db.select().from(session)).toHaveLength(0);
    expect(await authenticate(owner.token, { now: T0 })).toBeUndefined();
  });
});
