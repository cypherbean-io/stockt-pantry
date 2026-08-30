import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { getDb } from "../client";
import { household, invite, session, user } from "../schema";
import type { VerifiedSession } from "../scope";

/**
 * The identity layer: households, users and sessions.
 *
 * Everything else in this directory takes a `HouseholdScope` first. These
 * cannot, and the reason is not laziness — a person logging in or redeeming an
 * invite has no session yet, so there is no scope to take. The tenant key is
 * the *output* of these functions rather than an input to them, which is why
 * they live in their own module: `ownedBy` is meaningless here, so its absence
 * should not look like an oversight.
 *
 * Each one is keyed by something unguessable or already secret (an email plus a
 * password hash, a session token hash, an invite token hash) and none of them
 * accepts a household id from the caller.
 */

const UNIQUE_VIOLATION = "23505";

/** The fields postgres.js copies off the wire's ErrorResponse. */
type PostgresError = { readonly code?: string; readonly constraint_name?: string };

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose message is
 * `Failed query: <sql>\nparams: <bound values>` — for these queries that string
 * contains password hashes and invite token hashes, so it must never be logged
 * or matched against. The SQLSTATE hangs off `cause` instead.
 */
function driverError(error: unknown): PostgresError | null {
  return ((error as { cause?: unknown } | null)?.cause ?? error) as PostgresError | null;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = driverError(error);
  return cause?.code === UNIQUE_VIOLATION && cause?.constraint_name === constraint;
}

/**
 * Replace a driver error with one that is safe to let escape.
 *
 * Not matching on `DrizzleQueryError.message` is only half the rule — anything
 * that rethrows it hands the same string to whatever logs it upstream, and in
 * this module the bound parameters include password hashes and session token
 * hashes. So the original is dropped entirely, not attached as `cause`: Node
 * prints the whole cause chain when it reports an unhandled error.
 *
 * What survives is what CLAUDE.md says to log — the SQLSTATE and the
 * constraint. It is enough to tell a unique violation from an encoding error
 * from a dropped connection, which is all a caller can act on anyway.
 *
 * This is not hypothetical: `logIn` reaches `findUserCredentialsByEmail` with
 * whatever address an unauthenticated request posted, so any input Postgres
 * rejects outright (a NUL byte, SQLSTATE 22021) would otherwise print a real
 * user's stored hash into the log on the way out.
 */
function redacted(error: unknown): Error {
  const cause = driverError(error);
  const code = cause?.code ?? "unknown";
  const constraint = cause?.constraint_name;
  return new Error(
    `Auth query rejected by the database (SQLSTATE ${code}` +
      `${constraint === undefined ? "" : `, constraint ${constraint}`})`,
  );
}

/** Wraps a read: there is no expected failure, so everything is redacted. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw redacted(error);
  }
}

/**
 * `user.email` carries `CHECK (email = lower(email))`, and the lowering has to
 * happen in SQL on both the write and the lookup. JS `toLowerCase()` disagrees
 * with Postgres `lower()` on a handful of codepoints (U+0130, the dotted
 * capital I, is the classic), and normalising in two places produces an account
 * that can be created and then never signed into.
 */
function lowered(email: string) {
  return sql<string>`lower(${email}::text)`;
}

export type OwnerSignup = {
  readonly householdName: string;
  readonly email: string;
  readonly passwordHash: string;
};

export type CreatedMember = {
  readonly userId: string;
  readonly householdId: string;
};

export type SignupOutcome =
  | { readonly ok: true; readonly value: CreatedMember }
  | { readonly ok: false; readonly reason: "email-taken" };

/**
 * A new household and its first member, in one transaction.
 *
 * The transaction is the point: a duplicate email has to take the half-created
 * household with it, or every failed signup attempt leaves an empty household
 * nobody can reach.
 */
export async function createHouseholdWithOwner(input: OwnerSignup): Promise<SignupOutcome> {
  try {
    return await getDb().transaction(async (tx) => {
      const [householdRow] = await tx
        .insert(household)
        .values({ name: input.householdName })
        .returning({ id: household.id });
      if (householdRow === undefined) throw new Error("Insert returned no household row");

      const [userRow] = await tx
        .insert(user)
        .values({
          email: lowered(input.email),
          passwordHash: input.passwordHash,
          householdId: householdRow.id,
        })
        .returning({ id: user.id });
      if (userRow === undefined) throw new Error("Insert returned no user row");

      return {
        ok: true as const,
        value: { userId: userRow.id, householdId: householdRow.id },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error, "user_email_unique")) {
      return { ok: false, reason: "email-taken" };
    }
    throw redacted(error);
  }
}

export type UserCredentials = {
  readonly id: string;
  readonly householdId: string;
  readonly email: string;
  readonly passwordHash: string;
};

export async function findUserCredentialsByEmail(
  email: string,
): Promise<UserCredentials | undefined> {
  const rows = await guarded(() =>
    getDb()
      .select({
        id: user.id,
        householdId: user.householdId,
        email: user.email,
        passwordHash: user.passwordHash,
      })
      .from(user)
      .where(eq(user.email, lowered(email)))
      .limit(1),
  );
  return rows[0];
}

/**
 * Whether a token could be redeemed right now — unknown, already used and
 * expired all answer false alike.
 *
 * This is advisory, not the check. `redeemInviteIntoNewUser` re-tests the same
 * conditions inside the claim, so nothing races through the gap. It exists so
 * the join page can refuse a dead link without rendering a form, and so the
 * service can reject a garbage token before spending 250ms hashing a password
 * for it.
 */
export async function inviteIsRedeemable(tokenHash: string, now: Date): Promise<boolean> {
  const rows = await guarded(() =>
    getDb()
      .select({ id: invite.id })
      .from(invite)
      .where(
        and(eq(invite.tokenHash, tokenHash), isNull(invite.usedAt), gt(invite.expiresAt, now)),
      )
      .limit(1),
  );
  return rows.length > 0;
}

export type InviteRedemption = {
  readonly tokenHash: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly now: Date;
};

export type RedemptionOutcome =
  | { readonly ok: true; readonly value: CreatedMember }
  | { readonly ok: false; readonly reason: "invite-invalid" | "email-taken" };

/**
 * Claim an invite and create the member it was for, in one transaction.
 *
 * Single use (SPEC.md §4) is a conditional `UPDATE ... WHERE used_at IS NULL`
 * rather than a read followed by a write. Two simultaneous redemptions of the
 * same link serialise on the row lock; the loser re-evaluates the predicate
 * after the winner commits, matches nothing, and is told the invite is invalid.
 * A read-then-write would let both through.
 *
 * The insert riding in the same transaction is what stops a duplicate email
 * from burning the invite: the rollback un-marks it, so the invitee can retry
 * with an address they do own.
 */
export async function redeemInviteIntoNewUser(
  input: InviteRedemption,
): Promise<RedemptionOutcome> {
  try {
    return await getDb().transaction(async (tx) => {
      const [claimed] = await tx
        .update(invite)
        .set({ usedAt: input.now })
        .where(
          and(
            eq(invite.tokenHash, input.tokenHash),
            isNull(invite.usedAt),
            gt(invite.expiresAt, input.now),
          ),
        )
        .returning({ householdId: invite.householdId });

      if (claimed === undefined) {
        return { ok: false as const, reason: "invite-invalid" as const };
      }

      const [userRow] = await tx
        .insert(user)
        .values({
          email: lowered(input.email),
          passwordHash: input.passwordHash,
          // From the claimed invite, never from the caller — this is what makes
          // an invite the only way into an existing household.
          householdId: claimed.householdId,
        })
        .returning({ id: user.id });
      if (userRow === undefined) throw new Error("Insert returned no user row");

      return {
        ok: true as const,
        value: { userId: userRow.id, householdId: claimed.householdId },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error, "user_email_unique")) {
      return { ok: false, reason: "email-taken" };
    }
    throw redacted(error);
  }
}

export type NewSession = {
  readonly tokenHash: string;
  readonly userId: string;
  readonly householdId: string;
  readonly expiresAt: Date;
};

export async function createSession(values: NewSession): Promise<void> {
  await guarded(() => getDb().insert(session).values(values));
}

/**
 * Resolve a session token hash to the household it belongs to.
 *
 * Expiry is a predicate on the query, not a check the caller performs on the
 * returned row: an expired session must be indistinguishable from no session,
 * and a `SELECT` that hands back the row first invites someone to forget.
 */
export async function findSessionByTokenHash(
  tokenHash: string,
  now: Date,
): Promise<VerifiedSession | undefined> {
  const rows = await guarded(() =>
    getDb()
      .select({
        userId: session.userId,
        householdId: session.householdId,
        email: user.email,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .innerJoin(user, eq(user.id, session.userId))
      .where(and(eq(session.tokenHash, tokenHash), gt(session.expiresAt, now)))
      .limit(1),
  );
  return rows[0];
}

/** Logout. Deletes the row, so a captured token stops working immediately. */
export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await guarded(() => getDb().delete(session).where(eq(session.tokenHash, tokenHash)));
}
