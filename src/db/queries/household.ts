import { asc, eq } from "drizzle-orm";

import { getDb } from "../client";
import { guarded } from "../redact";
import { household, user, type HouseholdRow } from "../schema";
import type { HouseholdScope } from "../scope";

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
