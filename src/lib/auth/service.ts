import "server-only";

import { randomBytes } from "node:crypto";

import {
  createHouseholdWithOwner,
  createSession,
  deleteSessionByTokenHash,
  findPasswordResetAccount,
  findSessionByTokenHash,
  findUserCredentialsByEmail,
  inviteIsRedeemable,
  recordLoginAttempt,
  redeemInviteIntoNewUser,
  redeemPasswordReset,
} from "@/db/queries/auth";
import { deleteMember } from "@/db/queries/household";
import { createInvite, deleteInvite } from "@/db/queries/invites";
import { createPasswordReset } from "@/db/queries/password-resets";
import type { HouseholdScope, VerifiedSession } from "@/db/scope";

import {
  MAX_PASSWORD_LENGTH,
  couldBeAccountEmail,
  parseCredentials,
  parseHouseholdName,
  parseNewPassword,
} from "./credentials";
import type { FieldErrors } from "./credentials";
import type { AuthEnv } from "./env";
import { hashPassword, verifyPassword } from "./password";
import { signupTokenAccepted } from "./signup-token";
import { loginAttemptAllowed, loginWindowCutoff } from "./throttle";
import {
  INVITE_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
  expiresAt,
  generateToken,
  hashToken,
} from "./token";

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
  | "too-many-attempts"
  | "invite-invalid"
  | "reset-invalid";

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

/**
 * Undefined when `passwordHash` — the stored hash the member was just
 * authenticated against — has been replaced in the meantime. See
 * `createSession`: that is a password reset racing a sign-in.
 */
async function issueSession(
  member: { readonly userId: string; readonly householdId: string },
  passwordHash: string,
  now: Date,
): Promise<IssuedSession | undefined> {
  const token = generateToken();
  const expires = expiresAt(now, SESSION_TTL_MS);

  const created = await createSession({
    tokenHash: hashToken(token),
    userId: member.userId,
    householdId: member.householdId,
    expiresAt: expires,
    passwordHash,
  });
  if (!created) return undefined;

  return { token, expiresAt: expires, ...member };
}

/**
 * For signup and join, where the member was created a moment ago with the hash
 * in hand. Nothing can have reset it yet — a link needs a member who was there
 * first to issue it — so a refusal here is a bug, not a user error.
 */
async function issueFirstSession(
  member: { readonly userId: string; readonly householdId: string },
  passwordHash: string,
  now: Date,
): Promise<IssuedSession> {
  const issued = await issueSession(member, passwordHash, now);
  if (issued === undefined) throw new Error("No session for a member created moments ago");
  return issued;
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

  const passwordHash = await hashPassword(credentials.value.password);
  const created = await createHouseholdWithOwner({
    householdName: name.value,
    email: credentials.value.email,
    passwordHash,
  });
  if (!created.ok) {
    return { ok: false, error: "email-taken" };
  }

  return { ok: true, value: await issueFirstSession(created.value, passwordHash, now) };
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
 *
 * `too-many-attempts` is the one failure that says something different, and it
 * can afford to: it is keyed by the address as typed, before anything looks the
 * address up, so it arrives on the same attempt and as fast for an address
 * nobody has as for one somebody does. A correct password does not get past
 * it — that is the attempt the throttle exists to stop — and does not reset
 * the count either: only a real account can sign in, so a count that dropped
 * would tell anyone probing it that the address exists.
 */
export async function logIn(
  input: { readonly email: unknown; readonly password: unknown },
  options: Options = {},
): Promise<AuthResult<IssuedSession>> {
  const now = options.now ?? new Date();

  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  // `couldBeAccountEmail` before anything is counted or stored: an address no
  // account can have is most often a password typed into the wrong field.
  if (
    !couldBeAccountEmail(email) ||
    password === "" ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, error: "invalid-credentials" };
  }

  // Counted before the lookup and before the KDF, for the reason the signup
  // token is checked first: a refused attempt should cost no hashing.
  const attempts = await recordLoginAttempt(email, { now, windowCutoff: loginWindowCutoff(now) });
  if (!loginAttemptAllowed(attempts)) {
    return { ok: false, error: "too-many-attempts" };
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
  // no value an attacker can fix in a browser ahead of authentication. Opened
  // only if the hash just verified is still the member's — a password reset
  // landing during the KDF makes the password typed here the old one.
  const issued = await issueSession(
    { userId: found.id, householdId: found.householdId },
    found.passwordHash,
    now,
  );
  if (issued === undefined) {
    return { ok: false, error: "invalid-credentials" };
  }
  return { ok: true, value: issued };
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

  const passwordHash = await hashPassword(credentials.value.password);
  const redeemed = await redeemInviteIntoNewUser({
    tokenHash,
    email: credentials.value.email,
    passwordHash,
    now,
  });
  if (!redeemed.ok) {
    return { ok: false, error: redeemed.reason };
  }

  return { ok: true, value: await issueFirstSession(redeemed.value, passwordHash, now) };
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

/**
 * Withdraw an invite nobody has used yet. `false` covers another household's
 * id, a used invite and a malformed id alike — see `deleteInvite`.
 */
export async function revokeInvite(scope: HouseholdScope, inviteId: unknown): Promise<boolean> {
  if (typeof inviteId !== "string") return false;
  return deleteInvite(scope, inviteId);
}

/**
 * Remove a member who joined the caller's household after the caller did,
 * deleting their account and signing them out everywhere. `removedBy` is the
 * caller's own id, off their session. `false` covers every refusal alike — see
 * `deleteMember`.
 */
export async function removeMember(
  scope: HouseholdScope,
  removedBy: string,
  memberId: unknown,
): Promise<boolean> {
  if (typeof memberId !== "string") return false;
  return deleteMember(scope, { memberId, removedBy });
}

export type IssuedPasswordReset = {
  /** Shown once, in the link the member shares. Never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date;
};

/**
 * Issue a link that sets `memberId`'s password, replacing any they already
 * had. `issuedBy` is the caller's own id, off their session. Undefined covers
 * every refusal alike — yourself, someone who joined before you, someone in
 * another household, a malformed id — see `createPasswordReset`.
 */
export async function issuePasswordReset(
  scope: HouseholdScope,
  issuedBy: string,
  memberId: unknown,
  options: Options = {},
): Promise<IssuedPasswordReset | undefined> {
  if (typeof memberId !== "string") return undefined;

  const now = options.now ?? new Date();
  const token = generateToken();

  const created = await createPasswordReset(scope, {
    tokenHash: hashToken(token),
    memberId,
    createdBy: issuedBy,
    expiresAt: expiresAt(now, PASSWORD_RESET_TTL_MS),
  });
  if (created === undefined) return undefined;

  return { token, expiresAt: created.expiresAt };
}

/** The account a reset link is for, if it is still worth showing a form for. */
export async function passwordResetFor(
  token: string,
  options: Options = {},
): Promise<{ readonly email: string } | undefined> {
  if (token === "") return undefined;
  return findPasswordResetAccount(hashToken(token), options.now ?? new Date());
}

/**
 * Spend a reset link on a new password.
 *
 * Shaped like `joinWithInvite`: there is no parameter naming whose password
 * this sets — the link decides — and a dead link is turned away before the
 * 250ms of hashing. On success the member is signed out everywhere, every
 * link they issued is withdrawn, and they are *not* signed in: they use the
 * login form like any other time, so this flow never mints a session. The address comes back only so the page can say which
 * account to sign in to.
 */
export async function resetPassword(
  input: { readonly resetToken: unknown; readonly password: unknown },
  options: Options = {},
): Promise<AuthResult<{ readonly email: string }>> {
  const now = options.now ?? new Date();

  if (typeof input.resetToken !== "string" || input.resetToken === "") {
    return { ok: false, error: "reset-invalid" };
  }
  const tokenHash = hashToken(input.resetToken);

  if ((await findPasswordResetAccount(tokenHash, now)) === undefined) {
    return { ok: false, error: "reset-invalid" };
  }

  const password = parseNewPassword(input.password);
  if (!password.ok) {
    return { ok: false, error: "invalid-input", fieldErrors: password.errors };
  }

  const redeemed = await redeemPasswordReset({
    tokenHash,
    passwordHash: await hashPassword(password.value),
    now,
  });
  if (!redeemed.ok) {
    return { ok: false, error: redeemed.reason };
  }
  return { ok: true, value: redeemed.value };
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
