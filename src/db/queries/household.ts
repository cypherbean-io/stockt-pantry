import { and, asc, eq, gt, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "../client";
import { guarded } from "../redact";
import { household, user, type HouseholdRow } from "../schema";
import { isRowId, type HouseholdScope } from "../scope";

/**
 * The household itself and its members.
 *
 * These do not use `ownedBy`, and the reason is structural rather than an
 * exemption: `household` is keyed by `id`, not `household_id`, so the scoping
 * predicate *is* the primary key lookup. `listMembers` does carry
 * `household_id` and is scoped on it — by `eq` rather than `ownedBy` only
 * because `user` is not one of the tenant tables `TenantTable` describes.
 *
 * Both are guarded since SPEC.md §3.3 put `findHousehold` in the app shell.
 * A `DrizzleQueryError` escaping here used to reach Next's default error
 * handler from one route; it now would from every signed-in route, and it
 * formats as `Failed query: <sql>\nparams: <bound values>` — schema plus a
 * tenant id, and for `listMembers` the statement that selects member
 * addresses. CLAUDE.md treats rethrowing one as logging it.
 */

const LABEL = "Household query";

export async function findHousehold(scope: HouseholdScope): Promise<HouseholdRow | undefined> {
  const rows = await guarded(LABEL, () =>
    getDb().select().from(household).where(eq(household.id, scope.householdId)).limit(1),
  );
  return rows[0];
}

export type Member = {
  readonly id: string;
  readonly email: string;
  readonly createdAt: Date;
};

/**
 * Password hashes are excluded by listing the columns explicitly. A bare
 * `select()` would carry them into whatever renders the member list, and server
 * component props are serialised into the HTML payload.
 */
export async function listMembers(scope: HouseholdScope): Promise<Member[]> {
  return guarded(LABEL, () =>
    getDb()
      .select({ id: user.id, email: user.email, createdAt: user.createdAt })
      .from(user)
      .where(eq(user.householdId, scope.householdId))
      .orderBy(asc(user.createdAt)),
  );
}

export type MemberRemoval = {
  readonly memberId: string;
  /** Off the caller's session, never off the form. */
  readonly removedBy: string;
};

/**
 * Remove a member, which deletes their account: a user belongs to exactly one
 * household, so there is nowhere else for it to go. Their sessions and the
 * invites they issued cascade with them (`session_household_user_fk`,
 * `invite_household_created_by_fk`), so they are signed out everywhere and
 * nothing they handed out still works. That cascade takes their *used* invites
 * too, so the list stops showing who joined through them.
 *
 * A member can remove only someone who joined after them. Without that, a
 * leaked invite hands over the household for good: whoever arrives through it
 * deletes everyone who was there first. It also means the longest-standing
 * member can never be removed, so a household cannot be emptied — however the
 * removals interleave, each one points from senior to junior, so no two can
 * remove each other.
 *
 * Returns whether a member was removed. False for another household's member,
 * for an id that is not shaped like one, for the caller themselves, for anyone
 * who joined before the caller, and for a caller who is no longer a member —
 * a caller acting on something that is not theirs should not be able to tell
 * those apart.
 *
 * All of it is one statement, so there is no gap between checking and
 * deleting:
 *
 * - The caller's join time is a subquery on their own row, scoped to the
 *   household. A caller who has been removed since their session was checked,
 *   or who belongs to another household, yields NULL, and `>` NULL matches
 *   nothing. Comparing in SQL also keeps the microseconds a JS `Date` drops;
 *   rounded to milliseconds, a member who joined later in the same millisecond
 *   would rank level with — and so be able to remove — the one before them.
 * - "Not yourself" is `id <> removedBy` in SQL, not `!==` here. The seniority
 *   test already excludes it, but this says so; and Postgres compares uuids
 *   case-insensitively where JS compares strings exactly, so a check in JS
 *   would let an upper-cased copy of the caller's own id through.
 */
export async function deleteMember(
  scope: HouseholdScope,
  { memberId, removedBy }: MemberRemoval,
): Promise<boolean> {
  if (!isRowId(memberId) || !isRowId(removedBy)) {
    return false;
  }

  const caller = alias(user, "caller");
  const callerJoined = getDb()
    .select({ createdAt: caller.createdAt })
    .from(caller)
    .where(and(eq(caller.householdId, scope.householdId), eq(caller.id, removedBy)));

  const rows = await guarded(LABEL, () =>
    getDb()
      .delete(user)
      .where(
        and(
          eq(user.householdId, scope.householdId),
          eq(user.id, memberId),
          ne(user.id, removedBy),
          gt(user.createdAt, callerJoined),
        ),
      )
      .returning({ id: user.id }),
  );
  return rows.length > 0;
}
