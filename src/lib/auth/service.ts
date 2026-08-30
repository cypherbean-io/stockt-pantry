import "server-only";

import { randomBytes } from "node:crypto";

import {
  createHouseholdWithOwner,
  createSession,
  deleteSessionByTokenHash,
  findSessionByTokenHash,
  findUserCredentialsByEmail,
  inviteIsRedeemable,
  redeemInviteIntoNewUser,
} from "@/db/queries/auth";
import { createInvite } from "@/db/queries/invites";
import type { HouseholdScope, VerifiedSession } from "@/db/scope";

import { MAX_PASSWORD_LENGTH, parseCredentials, parseHouseholdName } from "./credentials";
import type { FieldErrors } from "./credentials";
import type { AuthEnv } from "./env";
import { hashPassword, verifyPassword } from "./password";
import { signupTokenAccepted } from "./signup-token";
import { INVITE_TTL_MS, SESSION_TTL_MS, expiresAt, generateToken, hashToken } from "./token";

/**
 * The auth flows (SPEC.md §2: household signup gated by a deployment secret,
 * invite-only join, email + password sessions).
 *
 * Nothing here touches `next/headers`. The flows return a token and let
 * `session.ts` decide how it reaches the browser, which is what keeps them
 * testable against a real database without a request context —
 * `src/db/auth-flow.db.test.ts`.
 */

export type AuthError =
  | "invalid-input"
  | "invalid-signup-token"
  | "email-taken"
  | "invalid-credentials"
  | "invite-invalid";

export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AuthError; readonly fieldErrors?: FieldErrors };

export type IssuedSession = {
  /** Shown to nobody and stored nowhere; it goes straight into the cookie. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly userId: string;
  readonly householdId: string;
};

export type Options = {
  readonly now?: Date;
  readonly env?: AuthEnv;
};

async function issueSession(
  member: { readonly userId: string; readonly householdId: string },
  now: Date,
): Promise<IssuedSession> {
  const token = generateToken();
  const expires = expiresAt(now, SESSION_TTL_MS);

  await createSession({
    tokenHash: hashToken(token),
    userId: member.userId,
    householdId: member.householdId,
    expiresAt: expires,
  });

  return { token, expiresAt: expires, ...member };
}

/**
 * A throwaway hash to verify against when the address does not exist, so a
 * login attempt costs the same either way.
 *
 * Without it, "no such user" returns in microseconds and "wrong password"
 * returns in ~250ms, which is a perfectly usable account-enumeration oracle
 * regardless of how carefully the two are worded identically.
 *
 * The input is random rather than a literal: nothing should be able to
 * authenticate against this, and a fixed string in source would read like a
 * credential even though it is not one. Computed once per process, lazily, so
 * importing this module does not cost a KDF run.
 *
 * One caveat for whoever raises `SCRYPT_PARAMS` later: the decoy is hashed at
 * *today's* parameters, while existing users keep whatever their stored string
 * records. Raise the cost and the two diverge, and the timing difference
 * becomes the enumeration oracle this exists to close. Rehash stored passwords
 * on next successful login at the same time, or the equality stops holding.
 */
let decoy: Promise<string> | undefined;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(32).toString("base64url"));
  return decoy;
}

/**
 * Create a household and its first member.
 *
 * The deployment token is checked before anything else, and specifically before
 * `hashPassword`: that is 250ms of memory-hard work, and running it for
 * unauthorised callers would turn an open form into a cheap way to saturate the
 * server.
 */
export async function signUpHousehold(
  input: {
    readonly householdName: unknown;
    readonly email: unknown;
    readonly password: unknown;
    readonly signupToken: unknown;
  },
  options: Options = {},
): Promise<AuthResult<IssuedSession>> {
  const now = options.now ?? new Date();

  if (!signupTokenAccepted(input.signupToken, options.env ?? process.env)) {
    return { ok: false, error: "invalid-signup-token" };
  }

  const name = parseHouseholdName(input.householdName);
  const credentials = parseCredentials(input);
  if (!name.ok || !credentials.ok) {
    return {
      ok: false,
      error: "invalid-input",
      fieldErrors: {
        ...(name.ok ? {} : name.errors),
        ...(credentials.ok ? {} : credentials.errors),
      },
    };
  }

  const created = await createHouseholdWithOwner({
    householdName: name.value,
    email: credentials.value.email,
    passwordHash: await hashPassword(credentials.value.password),
  });
  if (!created.ok) {
    return { ok: false, error: "email-taken" };
  }

  return { ok: true, value: await issueSession(created.value, now) };
}

/**
 * Every failure is the same `invalid-credentials`, including a malformed
 * address or an over-long password. A more helpful error is a more helpful
 * oracle, and the person who mistyped their own address does not need the app
 * to tell them which half was wrong.
 *
 * Note also what is *not* applied here: `MIN_PASSWORD_LENGTH`. Signup policy
 * belongs at signup — enforcing it at login would lock out every account
 * created before the policy was last raised.
 */
export async function logIn(
  input: { readonly email: unknown; readonly password: unknown },
  options: Options = {},
): Promise<AuthResult<IssuedSession>> {
  const now = options.now ?? new Date();

  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (email === "" || password === "" || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: "invalid-credentials" };
  }

  const found = await findUserCredentialsByEmail(email);
  if (found === undefined) {
    await verifyPassword(password, await decoyHash());
    return { ok: false, error: "invalid-credentials" };
  }

  if (!(await verifyPassword(password, found.passwordHash))) {
    return { ok: false, error: "invalid-credentials" };
  }

  // A fresh token per login: an existing session is never reissued, so there is
  // no value an attacker can fix in a browser ahead of authentication.
  return {
    ok: true,
    value: await issueSession({ userId: found.id, householdId: found.householdId }, now),
  };
}

/**
 * Join an existing household by redeeming an invite.
 *
 * The household is whatever the invite says. There is no parameter here that
 * names one, which is what makes "invite-only" structural rather than a check
 * someone has to remember.
 */
export async function joinWithInvite(
  input: {
    readonly inviteToken: unknown;
    readonly email: unknown;
    readonly password: unknown;
  },
  options: Options = {},
): Promise<AuthResult<IssuedSession>> {
  const now = options.now ?? new Date();

  if (typeof input.inviteToken !== "string" || input.inviteToken === "") {
    return { ok: false, error: "invite-invalid" };
  }
  const tokenHash = hashToken(input.inviteToken);

  // Cheap pre-check for the same reason the signup token is checked first: a
  // dead link should not cost a password hash. `redeemInviteIntoNewUser`
  // re-tests all of this inside the claim, so losing the race here changes
  // nothing.
  if (!(await inviteIsRedeemable(tokenHash, now))) {
    return { ok: false, error: "invite-invalid" };
  }

  const credentials = parseCredentials(input);
  if (!credentials.ok) {
    return { ok: false, error: "invalid-input", fieldErrors: credentials.errors };
  }

  const redeemed = await redeemInviteIntoNewUser({
    tokenHash,
    email: credentials.value.email,
    passwordHash: await hashPassword(credentials.value.password),
    now,
  });
  if (!redeemed.ok) {
    return { ok: false, error: redeemed.reason };
  }

  return { ok: true, value: await issueSession(redeemed.value, now) };
}

export type IssuedInvite = {
  /** Shown once, in the link the member shares. Never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly inviteId: string;
};

export async function issueInvite(
  scope: HouseholdScope,
  createdBy: string,
  options: Options = {},
): Promise<IssuedInvite> {
  const now = options.now ?? new Date();
  const token = generateToken();
  const expires = expiresAt(now, INVITE_TTL_MS);

  const created = await createInvite(scope, {
    tokenHash: hashToken(token),
    createdBy,
    expiresAt: expires,
  });

  return { token, expiresAt: expires, inviteId: created.id };
}

/** Whether an invite link is still worth showing a form for. */
export async function inviteIsOpen(token: string, options: Options = {}): Promise<boolean> {
  if (token === "") return false;
  return inviteIsRedeemable(hashToken(token), options.now ?? new Date());
}

/**
 * Resolve a cookie value to a session, or to nothing.
 *
 * Unknown token, expired session and absent cookie are one answer on purpose —
 * a caller that can distinguish them will eventually branch on the difference.
 */
export async function authenticate(
  token: string | undefined,
  options: Options = {},
): Promise<VerifiedSession | undefined> {
  if (typeof token !== "string" || token === "") return undefined;
  return findSessionByTokenHash(hashToken(token), options.now ?? new Date());
}

/** Revokes server-side, so clearing the cookie is not what makes logout work. */
export async function logOut(token: string | undefined): Promise<void> {
  if (typeof token !== "string" || token === "") return;
  await deleteSessionByTokenHash(hashToken(token));
}
