import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { invite, passwordReset, session, user } from "./schema";
import { scopeForSession, unsafeHouseholdScopeFromId } from "./scope";
import { listMembers } from "./queries/household";
import { listInvites } from "./queries/invites";
import { resetDatabase, testDb } from "./testing/harness";
import {
  authenticate,
  inviteIsOpen,
  issueInvite,
  issueResetLink,
  joinWithInvite,
  logIn,
  logOut,
  passwordResetFor,
  removeMember,
  resetPassword,
  revokeInvite,
  signUpHousehold,
  type AuthResult,
  type IssuedSession,
} from "@/lib/auth/service";
import type { AuthEnv } from "@/lib/auth/env";
import { hashToken } from "@/lib/auth/token";
import {
  createHouseholdWithOwner,
  createSession,
  findUserCredentialsByEmail,
  redeemInviteIntoNewUser,
  redeemPasswordReset,
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

/**
 * Resolves once `pending` has settled, or once Postgres reports a backend
 * waiting on a row lock — whichever comes first. The DB test files run one at
 * a time, so a lock wait in this database is the statement under test. What
 * the caller asserts afterwards does not depend on how long either took.
 */
async function settledOrWaitingOnALock(pending: Promise<unknown>): Promise<void> {
  let settled = false;
  pending.then(
    () => (settled = true),
    () => (settled = true),
  );

  while (!settled) {
    const [row] = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function scopeOf(member: { readonly householdId: string }) {
  return unsafeHouseholdScopeFromId(member.householdId);
}

function issued<T>(result: AuthResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.value;
}

/** A second member of `owner`'s household, joined through an invite `owner` issued. */
async function inviteMember(
  owner: { readonly userId: string; readonly householdId: string },
  email: string,
): Promise<IssuedSession> {
  const { token } = await issueInvite(scopeOf(owner), owner.userId, { now: T0 });
  return issued(
    await joinWithInvite({ inviteToken: token, email, password: PASSWORD }, { now: T0 }),
  );
}

describe("removing a member", () => {
  it("signs the removed member out on every device", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const otherDevice = issued(
      await logIn({ email: "second@alpha.example", password: PASSWORD }, { now: T0 }),
    );

    expect(await removeMember(scopeOf(owner), owner.userId, second.userId)).toBe(true);

    expect(await authenticate(second.token, { now: T0 })).toBeUndefined();
    expect(await authenticate(otherDevice.token, { now: T0 })).toBeUndefined();
  });

  it("deletes the removed member's account and leaves everyone else's", async () => {
    // A user belongs to exactly one household, so there is nowhere else for
    // the account to go. Inviting them again is how they come back.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");

    await removeMember(scopeOf(owner), owner.userId, second.userId);

    expect(
      await logIn({ email: "second@alpha.example", password: PASSWORD }, { now: T0 }),
    ).toEqual({ ok: false, error: "invalid-credentials" });
    expect((await listMembers(scopeOf(owner))).map((row) => row.id)).toEqual([owner.userId]);
    expect(await authenticate(owner.token, { now: T0 })).toBeDefined();
  });

  it("stops the invites the removed member issued from letting anyone in", async () => {
    // Otherwise removing someone would leave behind a link they could hand to
    // anyone, themselves included.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const { token } = await issueInvite(scopeOf(owner), second.userId, { now: T0 });

    await removeMember(scopeOf(owner), owner.userId, second.userId);

    expect(await inviteIsOpen(token, { now: T0 })).toBe(false);
  });

  it("refuses to remove the member who is asking", async () => {
    // Leaving a household is deleting your own account, which is not this
    // feature.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    await inviteMember(owner, "second@alpha.example");

    expect(await removeMember(scopeOf(owner), owner.userId, owner.userId)).toBe(false);
    expect(await authenticate(owner.token, { now: T0 })).toBeDefined();
  });

  it("refuses to remove the member who is asking when their id arrives upper-cased", async () => {
    // A uuid is case-insensitive to Postgres but not to `!==`, so a hand-edited
    // form could otherwise spell the caller's own id past a check in JS.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    await inviteMember(owner, "second@alpha.example");

    expect(
      await removeMember(scopeOf(owner), owner.userId, owner.userId.toUpperCase()),
    ).toBe(false);
    expect(await authenticate(owner.token, { now: T0 })).toBeDefined();
  });

  it("refuses to remove a member who joined before the one asking", async () => {
    // Seniority is what stops a leaked invite from handing over the household:
    // whoever arrives through it can remove nobody who was there first, and the
    // longest-standing member can never be removed at all.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");

    expect(await removeMember(scopeOf(owner), second.userId, owner.userId)).toBe(false);
    expect(await authenticate(owner.token, { now: T0 })).toBeDefined();
  });

  it("ranks members who joined in the same millisecond by Postgres's clock, not JavaScript's", async () => {
    // `created_at` holds microseconds and a JS `Date` holds milliseconds. A
    // comparison that round-tripped through JS would round the later member
    // down to the earlier one's millisecond and let them remove someone who
    // was there first.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const rows = await db
      .insert(user)
      .values(
        [
          ["earlier@alpha.example", "2030-01-01T00:00:00.000100Z"],
          ["later@alpha.example", "2030-01-01T00:00:00.000900Z"],
        ].map(([email, joined]) => ({
          email: email!,
          // Not a credential: nothing signs in as these two.
          passwordHash: "placeholder-not-a-real-hash",
          householdId: owner.householdId,
          createdAt: sql`${joined}::timestamptz`,
        })),
      )
      .returning({ id: user.id, email: user.email });
    const earlier = rows.find((row) => row.email === "earlier@alpha.example")!;
    const later = rows.find((row) => row.email === "later@alpha.example")!;

    expect(await removeMember(scopeOf(owner), later.id, earlier.id)).toBe(false);
    expect(await removeMember(scopeOf(owner), earlier.id, later.id)).toBe(true);
  });

  it("refuses a removal asked for by a member who has already been removed", async () => {
    // Their request can be in flight past its session check when the removal
    // lands, so the query asks again rather than trusting that check. Three
    // members, so the one removed was senior to the one they then try to
    // remove, and seniority alone would not refuse it.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const third = await inviteMember(owner, "third@alpha.example");
    await removeMember(scopeOf(owner), owner.userId, second.userId);

    expect(await removeMember(scopeOf(owner), second.userId, third.userId)).toBe(false);
    expect((await listMembers(scopeOf(owner))).map((row) => row.id)).toEqual([
      owner.userId,
      third.userId,
    ]);
  });

  it.each([
    ["a malformed id", "not-a-uuid"],
    ["a missing field", null],
  ])("answers false, without throwing, for %s", async (_label, memberId) => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    await inviteMember(owner, "second@alpha.example");

    expect(await removeMember(scopeOf(owner), owner.userId, memberId)).toBe(false);
    expect(await listMembers(scopeOf(owner))).toHaveLength(2);
  });
});

describe("revoking an invite", () => {
  it("stops an open invite from being redeemed", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const { token, inviteId } = await issueInvite(scopeOf(owner), owner.userId, { now: T0 });

    expect(await revokeInvite(scopeOf(owner), inviteId)).toBe(true);

    expect(
      await joinWithInvite(
        { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
        { now: after(1) },
      ),
    ).toEqual({ ok: false, error: "invite-invalid" });
  });

  it("takes a revoked invite off the household's list", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const { inviteId } = await issueInvite(scopeOf(owner), owner.userId, { now: T0 });

    await revokeInvite(scopeOf(owner), inviteId);

    expect((await listInvites(scopeOf(owner))).map((row) => row.id)).not.toContain(inviteId);
  });

  it("leaves an invite that has already been used on the record", async () => {
    // Revoking it would not un-join anyone; removing the member does that.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const { token, inviteId } = await issueInvite(scopeOf(owner), owner.userId, { now: T0 });
    issued(
      await joinWithInvite(
        { inviteToken: token, email: "second@alpha.example", password: PASSWORD },
        { now: after(1) },
      ),
    );

    expect(await revokeInvite(scopeOf(owner), inviteId)).toBe(false);
    expect((await listInvites(scopeOf(owner))).find((row) => row.id === inviteId)?.status).toBe(
      "used",
    );
  });

  it.each([
    ["a malformed id", "not-a-uuid"],
    ["a missing field", null],
  ])("answers false, without throwing, for %s", async (_label, inviteId) => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    await issueInvite(scopeOf(owner), owner.userId, { now: T0 });

    expect(await revokeInvite(scopeOf(owner), inviteId)).toBe(false);
    expect(await listInvites(scopeOf(owner))).toHaveLength(1);
  });
});

describe("password reset links", () => {
  const NEW_PASSWORD = "an entirely different passphrase";

  /** `owner` and a member who joined after them, with a link `owner` issued for that member. */
  async function ownerAndResetLink() {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const link = await issueResetLink(scopeOf(owner), owner.userId, second.userId, {
      now: T0,
    });
    if (link === undefined) throw new Error("expected a reset link to be issued");
    return { owner, second, link };
  }

  it("lets the member sign in with the new password and not the old one", async () => {
    const { link } = await ownerAndResetLink();

    const result = await resetPassword(
      { resetToken: link.token, password: NEW_PASSWORD },
      { now: T0 },
    );

    expect(result).toEqual({ ok: true, value: { email: "second@alpha.example" } });
    expect(
      (await logIn({ email: "second@alpha.example", password: NEW_PASSWORD }, { now: T0 })).ok,
    ).toBe(true);
    expect(
      await logIn({ email: "second@alpha.example", password: PASSWORD }, { now: T0 }),
    ).toEqual({ ok: false, error: "invalid-credentials" });
  });

  it("signs the member out on every device", async () => {
    // A reset is as often "someone else may have my password" as "I forgot
    // it", and the first only ends when the sessions they hold do.
    const { second, link } = await ownerAndResetLink();
    const otherDevice = issued(
      await logIn({ email: "second@alpha.example", password: PASSWORD }, { now: T0 }),
    );

    await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 });

    expect(await authenticate(second.token, { now: T0 })).toBeUndefined();
    expect(await authenticate(otherDevice.token, { now: T0 })).toBeUndefined();
  });

  it("stops the reset links the member had issued from working", async () => {
    // Whoever held the old password could have minted these, and nothing
    // lists them — a reset that left them working would recover nothing.
    // Removal already takes them, through the `created_by` cascade.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const third = await inviteMember(owner, "third@alpha.example");
    const minted = await issueResetLink(scopeOf(owner), second.userId, third.userId, {
      now: T0,
    });
    const link = await issueResetLink(scopeOf(owner), owner.userId, second.userId, {
      now: T0,
    });

    await resetPassword({ resetToken: link!.token, password: NEW_PASSWORD }, { now: T0 });

    expect(await passwordResetFor(minted!.token, { now: T0 })).toBeUndefined();
  });

  it("stops the open invites the member had issued from letting anyone in", async () => {
    const { owner, second, link } = await ownerAndResetLink();
    const { token } = await issueInvite(scopeOf(owner), second.userId, { now: T0 });

    await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 });

    expect(await inviteIsOpen(token, { now: T0 })).toBe(false);
  });

  it("leaves the invites the member issued that were already used on the record", async () => {
    // Revoking a used invite un-joins nobody, and the list is how the
    // household sees who came in through whom.
    const { owner, second, link } = await ownerAndResetLink();
    const { token, inviteId } = await issueInvite(scopeOf(owner), second.userId, { now: T0 });
    await joinWithInvite(
      { inviteToken: token, email: "third@alpha.example", password: PASSWORD },
      { now: T0 },
    );

    await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 });

    expect((await listInvites(scopeOf(owner))).map((row) => row.id)).toContain(inviteId);
  });

  it("opens no session for a sign-in whose password was replaced while it was checked", async () => {
    // `logIn` reads the hash, spends ~250ms verifying against it, then opens
    // the session. A reset landing in between has already deleted every
    // session it can see, so the one opened afterwards has to be refused on
    // the hash it was verified against — or it outlives the reset.
    const { second, link } = await ownerAndResetLink();
    const verified = (await findUserCredentialsByEmail("second@alpha.example"))!.passwordHash;

    await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 });

    expect(
      await createSession({
        tokenHash: "hash-of-a-late-sign-in",
        userId: second.userId,
        householdId: second.householdId,
        expiresAt: after(30),
        passwordHash: verified,
      }),
    ).toBe(false);
    expect(
      await db.select().from(session).where(eq(session.tokenHash, "hash-of-a-late-sign-in")),
    ).toHaveLength(0);
  });

  it("makes a sign-in wait for a password change in flight rather than read past it", async () => {
    // The same race with the reset still uncommitted. Read past it, the
    // sign-in sees the old hash and opens a session after the reset's delete
    // has run. Waiting on the row, it sees the new one and opens nothing.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const verified = (await findUserCredentialsByEmail("owner@alpha.example"))!.passwordHash;

    let signIn: Promise<boolean> | undefined;
    await db.transaction(async (tx) => {
      await tx
        .update(user)
        // Not a credential: a stand-in for the hash a reset would write.
        .set({ passwordHash: "placeholder-not-a-real-hash" })
        .where(eq(user.id, owner.userId));

      signIn = createSession({
        tokenHash: "hash-of-a-racing-sign-in",
        userId: owner.userId,
        householdId: owner.householdId,
        expiresAt: after(30),
        passwordHash: verified,
      });
      await settledOrWaitingOnALock(signIn);
    });

    expect(await signIn).toBe(false);
  });

  it("does not sign anyone in", async () => {
    // The member signs in through the login form like any other time, so a
    // link is never a way to obtain a session directly.
    const { second, link } = await ownerAndResetLink();

    await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 });

    expect(
      await db.select().from(session).where(sql`${session.userId} = ${second.userId}`),
    ).toHaveLength(0);
  });

  it("leaves every other member's password and sessions alone", async () => {
    const { owner, link } = await ownerAndResetLink();

    await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 });

    expect(await authenticate(owner.token, { now: T0 })).toBeDefined();
    expect(
      (await logIn({ email: "owner@alpha.example", password: PASSWORD }, { now: T0 })).ok,
    ).toBe(true);
  });

  it("works exactly once", async () => {
    const { link } = await ownerAndResetLink();

    const first = await resetPassword(
      { resetToken: link.token, password: NEW_PASSWORD },
      { now: T0 },
    );
    const second = await resetPassword(
      { resetToken: link.token, password: "a third passphrase, also long" },
      { now: T0 },
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "reset-invalid" });
    expect(
      (await logIn({ email: "second@alpha.example", password: NEW_PASSWORD }, { now: T0 })).ok,
    ).toBe(true);
  });

  it("lets exactly one of two simultaneous redemptions through", async () => {
    const { link } = await ownerAndResetLink();

    const results = await Promise.all([
      resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 }),
      resetPassword(
        { resetToken: link.token, password: "a third passphrase, also long" },
        { now: T0 },
      ),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("lasts a day, not the week an invite does", async () => {
    // It is a working credential for an account that already holds the
    // household's data, carried over whatever channel the issuer picked.
    const { link } = await ownerAndResetLink();

    expect(link.expiresAt).toEqual(after(1));
  });

  it("is rejected once it has expired", async () => {
    const { link } = await ownerAndResetLink();

    const late = new Date(link.expiresAt.getTime() + 1000);
    const result = await resetPassword(
      { resetToken: link.token, password: NEW_PASSWORD },
      { now: late },
    );

    expect(result).toEqual({ ok: false, error: "reset-invalid" });
    expect(
      (await logIn({ email: "second@alpha.example", password: PASSWORD }, { now: T0 })).ok,
    ).toBe(true);
  });

  it.each([
    ["a token that was never issued", "made-up-token"],
    ["an empty token", ""],
    ["a missing field", null],
  ])("rejects %s", async (_label, resetToken) => {
    await ownerAndResetLink();

    expect(await resetPassword({ resetToken, password: NEW_PASSWORD }, { now: T0 })).toEqual({
      ok: false,
      error: "reset-invalid",
    });
  });

  it("is not consumed by a new password that is too short", async () => {
    // Burning the link on a typo would leave the member with no password and
    // no way to set one until somebody issues another.
    const { link } = await ownerAndResetLink();

    const short = await resetPassword({ resetToken: link.token, password: "short" }, { now: T0 });
    expect(short.ok).toBe(false);
    expect(!short.ok && short.error).toBe("invalid-input");
    expect(!short.ok && Object.keys(short.fieldErrors ?? {})).toEqual(["password"]);

    const retry = await resetPassword(
      { resetToken: link.token, password: NEW_PASSWORD },
      { now: T0 },
    );
    expect(retry.ok).toBe(true);
  });

  it("stores only the hash of the token it hands out", async () => {
    const { link } = await ownerAndResetLink();

    const [row] = await db.select().from(passwordReset);
    expect(row?.tokenHash).not.toBe(link.token);
    expect(row?.tokenHash).toBe(hashToken(link.token));
  });

  it("names the account it is for while it is open, and nothing after", async () => {
    // The reset page says whose password is about to change. A used link
    // answers like one that never existed.
    const { link } = await ownerAndResetLink();

    expect(await passwordResetFor(link.token, { now: T0 })).toEqual({
      email: "second@alpha.example",
    });

    await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 });

    expect(await passwordResetFor(link.token, { now: T0 })).toBeUndefined();
    expect(await passwordResetFor("", { now: T0 })).toBeUndefined();
  });

  it("replaces the member's earlier link when another is issued", async () => {
    // Issuing again is how a link pasted into the wrong chat gets withdrawn,
    // so a member never has more than one that works.
    const { owner, second, link: first } = await ownerAndResetLink();
    const replacement = await issueResetLink(scopeOf(owner), owner.userId, second.userId, {
      now: T0,
    });

    expect(
      await resetPassword({ resetToken: first.token, password: NEW_PASSWORD }, { now: T0 }),
    ).toEqual({ ok: false, error: "reset-invalid" });
    expect(
      (
        await resetPassword(
          { resetToken: replacement!.token, password: NEW_PASSWORD },
          { now: T0 },
        )
      ).ok,
    ).toBe(true);
    expect(await db.select().from(passwordReset)).toHaveLength(0);
  });

  it("keeps one link per member, not one per household", async () => {
    const { owner, link } = await ownerAndResetLink();
    const third = await inviteMember(owner, "third@alpha.example");
    await issueResetLink(scopeOf(owner), owner.userId, third.userId, { now: T0 });

    expect(await passwordResetFor(link.token, { now: T0 })).toBeDefined();
  });

  it("refuses to issue a link for the member who is asking", async () => {
    // Changing your own password is a different feature; this one exists for
    // the member who cannot sign in.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");

    expect(
      await issueResetLink(scopeOf(owner), owner.userId, owner.userId, { now: T0 }),
    ).toBeUndefined();
    expect(
      await issueResetLink(scopeOf(owner), owner.userId, owner.userId.toUpperCase(), {
        now: T0,
      }),
    ).toBeUndefined();
  });

  it("refuses to issue a link for a member who joined before the one asking", async () => {
    // A link is a way into the account it names. The same seniority that
    // decides who may remove whom keeps a leaked invite from becoming the
    // founder's account, and with it the power to remove everyone else.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");

    expect(
      await issueResetLink(scopeOf(owner), second.userId, owner.userId, { now: T0 }),
    ).toBeUndefined();
    expect(await db.select().from(passwordReset)).toHaveLength(0);
  });

  it("refuses a link asked for by a member who has already been removed", async () => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const third = await inviteMember(owner, "third@alpha.example");
    await removeMember(scopeOf(owner), owner.userId, second.userId);

    expect(
      await issueResetLink(scopeOf(owner), second.userId, third.userId, { now: T0 }),
    ).toBeUndefined();
  });

  it.each([
    ["a malformed id", "not-a-uuid"],
    ["a missing field", null],
  ])("answers undefined, without throwing, for %s", async (_label, memberId) => {
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    await inviteMember(owner, "second@alpha.example");

    expect(
      await issueResetLink(scopeOf(owner), owner.userId, memberId, { now: T0 }),
    ).toBeUndefined();
  });

  it("stops working when the member who issued it is removed", async () => {
    // As with invites: removing someone withdraws what they handed out.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const third = await inviteMember(owner, "third@alpha.example");
    const link = await issueResetLink(scopeOf(owner), second.userId, third.userId, {
      now: T0,
    });

    await removeMember(scopeOf(owner), owner.userId, second.userId);

    expect(await passwordResetFor(link!.token, { now: T0 })).toBeUndefined();
  });

  it("stops working when the member it was for is removed", async () => {
    const { owner, second, link } = await ownerAndResetLink();

    await removeMember(scopeOf(owner), owner.userId, second.userId);

    expect(
      await resetPassword({ resetToken: link.token, password: NEW_PASSWORD }, { now: T0 }),
    ).toEqual({ ok: false, error: "reset-invalid" });
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

  it("does not carry bound parameters out of a password reset failure", async () => {
    // The bound values here are the new password hash and the link's token
    // hash — one of them a working credential until the transaction commits.
    const owner = await signUpOwner("Alpha", "owner@alpha.example");
    const second = await inviteMember(owner, "second@alpha.example");
    const link = await issueResetLink(scopeOf(owner), owner.userId, second.userId, {
      now: T0,
    });

    const error = await rejection(
      redeemPasswordReset({
        tokenHash: hashToken(link!.token),
        passwordHash: `scrypt$16384$8$1$c2FsdA$${MARKER}${"\u0000"}`,
        now: T0,
      }),
    );

    expect(error.message).not.toContain(MARKER);
    expect(error.message).not.toContain(hashToken(link!.token));
    expect(error.message).not.toContain("params:");
    expect(error.message).toContain("22021");
    // Rolled back, so the link still works and the old password still does.
    expect(await passwordResetFor(link!.token, { now: T0 })).toBeDefined();
    expect(await authenticate(second.token, { now: T0 })).toBeDefined();
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
