import { and, eq, gt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "../client";
import { guarded } from "../redact";
import { passwordReset, user } from "../schema";
import { isRowId, type HouseholdScope } from "../scope";

/**
 * Issuing password reset links, for a household's own members.
 *
 * Redeeming one is deliberately absent, as it is from `./invites`: the person
 * holding the link cannot sign in, so has no scope, and that lookup is by token
 * hash in `./auth.ts`.
 */

const LABEL = "Password reset query";

export type NewPasswordReset = {
  /** The hash of the token; the token itself is returned to the caller once. */
  readonly tokenHash: string;
  /** Whose password the link sets. Off the form, so not trusted. */
  readonly memberId: string;
  /** Off the caller's session, never off the form. */
  readonly createdBy: string;
  readonly expiresAt: Date;
};

export type CreatedPasswordReset = {
  readonly expiresAt: Date;
};

/**
 * Issue a link that sets `memberId`'s password, replacing any link they
 * already had outstanding. Undefined when it is refused.
 *
 * A link opens the account it names, so who may issue one follows who may
 * remove whom (`deleteMember`): only someone who joined *before* the member.
 * Anything looser lets a leaked invite reach the founder's account through
 * this, and from there remove everyone else. A member removable by the caller
 * gains them nothing through a reset they could not already do outright.
 *
 * One statement, for the reasons `deleteMember` gives: the caller's join time
 * is a subquery on their own row in the scope's household (gone or elsewhere
 * yields NULL, and `>` NULL matches nothing), and "not yourself" is a uuid
 * comparison in SQL rather than `!==` on strings.
 *
 * The upsert is the replacement. `password_reset_household_user_unique` allows
 * one outstanding link per member, and a new one overwrites the old token hash
 * in place, so the old link stops working the moment the new one exists. The
 * conflict target includes `household_id`, and the row being inserted only
 * ever carries the scope's, so it cannot overwrite another household's link.
 *
 * Guarded: the bound values include the token hash.
 */
export async function createPasswordReset(
  scope: HouseholdScope,
  values: NewPasswordReset,
): Promise<CreatedPasswordReset | undefined> {
  if (!isRowId(values.memberId) || !isRowId(values.createdBy)) {
    return undefined;
  }

  const db = getDb();
  const caller = alias(user, "caller");
  const callerJoined = db
    .select({ createdAt: caller.createdAt })
    .from(caller)
    .where(and(eq(caller.householdId, scope.householdId), eq(caller.id, values.createdBy)));

  const rows = await guarded(LABEL, () =>
    db
      .insert(passwordReset)
      .select(
        // Every column, in table order: Drizzle's insert-select requires it.
        db
          .select({
            tokenHash: sql<string>`${values.tokenHash}::text`.as("token_hash"),
            householdId: user.householdId,
            userId: user.id,
            createdBy: sql<string>`${values.createdBy}::uuid`.as("created_by"),
            expiresAt: sql<Date>`${values.expiresAt.toISOString()}::timestamptz`.as(
              "expires_at",
            ),
            createdAt: sql<Date>`now()`.as("created_at"),
          })
          .from(user)
          .where(
            and(
              eq(user.householdId, scope.householdId),
              eq(user.id, values.memberId),
              ne(user.id, values.createdBy),
              gt(user.createdAt, callerJoined),
            ),
          ),
      )
      .onConflictDoUpdate({
        target: [passwordReset.householdId, passwordReset.userId],
        set: {
          tokenHash: sql`excluded.token_hash`,
          createdBy: sql`excluded.created_by`,
          expiresAt: sql`excluded.expires_at`,
          createdAt: sql`excluded.created_at`,
        },
      })
      .returning({ expiresAt: passwordReset.expiresAt }),
  );
  return rows[0];
}
