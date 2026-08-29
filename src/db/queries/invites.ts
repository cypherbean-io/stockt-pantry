import { desc, eq } from "drizzle-orm";

import { getDb } from "../client";
import { invite } from "../schema";
import { ownedBy, type HouseholdScope } from "../scope";

/**
 * Invite reads for a household's own members (SPEC.md §5: household A must not
 * be able to read household B's invites).
 *
 * Redeeming an invite is deliberately absent: the person redeeming has no
 * session and therefore no scope, so that lookup is by token hash and belongs
 * with the auth slice, along with the single-use and expiry checks.
 */

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

export async function listInvites(scope: HouseholdScope): Promise<InviteSummary[]> {
  return getDb()
    .select(inviteColumns)
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
