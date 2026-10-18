import { desc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "../client";
import { guarded } from "../redact";
import { invite } from "../schema";
import { isRowId, ownedBy, type HouseholdScope } from "../scope";

/**
 * Invite reads and issuance for a household's own members (SPEC.md §5:
 * household A must not be able to read household B's invites).
 *
 * Redeeming an invite is deliberately absent: the person redeeming has no
 * session and therefore no scope, so that lookup is by token hash and lives in
 * `./auth.ts` with the single-use and expiry checks.
 */

const LABEL = "Invite query";

/**
 * Every column except `token_hash`.
 *
 * `token_hash` is the key the auth slice will redeem an invite by, and a bare
 * `select()` would carry it into whatever renders the invite list — server
 * component props are serialized into the HTML payload. Callers have no use for
 * it, so it does not leave this directory.
 */
const inviteColumns = {
  id: invite.id,
  householdId: invite.householdId,
  createdBy: invite.createdBy,
  expiresAt: invite.expiresAt,
  usedAt: invite.usedAt,
  createdAt: invite.createdAt,
} as const;

export type InviteSummary = {
  readonly id: string;
  readonly householdId: string;
  readonly createdBy: string | null;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
};

export type InviteStatus = "open" | "used" | "expired";

export type InviteListing = InviteSummary & { readonly status: InviteStatus };

/**
 * `status` is derived in SQL rather than from the row's dates in JS, for two
 * reasons. It puts "has this expired" in the same place redemption asks the
 * question (`inviteIsRedeemable`, also a SQL predicate), so a listing cannot
 * disagree with what actually happens on submit. And a Server Component may not
 * call `Date.now()` during render — a value that changes between renders is not
 * a thing a pure component can produce.
 */
export async function listInvites(scope: HouseholdScope): Promise<InviteListing[]> {
  return getDb()
    .select({
      ...inviteColumns,
      status: sql<InviteStatus>`case
        when ${invite.usedAt} is not null then 'used'
        when ${invite.expiresAt} <= now() then 'expired'
        else 'open'
      end`,
    })
    .from(invite)
    .where(ownedBy(scope, invite))
    .orderBy(desc(invite.createdAt));
}

export async function findInviteById(
  scope: HouseholdScope,
  id: string,
): Promise<InviteSummary | undefined> {
  const rows = await getDb()
    .select(inviteColumns)
    .from(invite)
    .where(ownedBy(scope, invite, eq(invite.id, id)))
    .limit(1);
  return rows[0];
}

export type NewInvite = {
  /** The hash of the token; the token itself is returned to the caller once. */
  readonly tokenHash: string;
  readonly createdBy: string;
  readonly expiresAt: Date;
};

/**
 * Issue an invite into the caller's own household.
 *
 * The household comes from the scope, so an invite is always into the household
 * of whoever created it. `createdBy` is still caller-supplied, but the
 * composite `invite_household_created_by_fk` means Postgres rejects a member id
 * from any other household rather than storing a mislabelled invite.
 *
 * Guarded because that rejection is reachable: a member removed while their
 * request is in flight credits someone who is gone. The bound values include
 * the token hash, which an unredacted error would print into the log.
 */
export async function createInvite(
  scope: HouseholdScope,
  values: NewInvite,
): Promise<InviteSummary> {
  const rows = await guarded(LABEL, () =>
    getDb()
      .insert(invite)
      .values({
        householdId: scope.householdId,
        tokenHash: values.tokenHash,
        createdBy: values.createdBy,
        expiresAt: values.expiresAt,
      })
      .returning(inviteColumns),
  );

  const created = rows[0];
  if (created === undefined) {
    throw new Error("Insert returned no invite row");
  }
  return created;
}

/**
 * Revoke an invite nobody has used yet, by deleting it. Redemption looks an
 * invite up by its token hash, so once the row is gone the link answers like
 * one that never existed — no change to the redeem path needed.
 *
 * `used_at IS NULL` leaves used invites alone: revoking one would not un-join
 * anyone, and that is what removing the member is for. (Removing the member
 * who *issued* one does delete it — see `deleteMember`.) A revocation
 * racing a redemption serialises with it on the row lock, so exactly one of
 * them wins.
 *
 * Returns whether an invite was revoked. False for another household's id, for
 * a used one, and for an id that is not shaped like one at all.
 */
export async function deleteInvite(scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isRowId(id)) {
    return false;
  }

  const rows = await guarded(LABEL, () =>
    getDb()
      .delete(invite)
      .where(ownedBy(scope, invite, eq(invite.id, id), isNull(invite.usedAt)))
      .returning({ id: invite.id }),
  );
  return rows.length > 0;
}
