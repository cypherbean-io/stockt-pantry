import { findHousehold, listMembers } from "@/db/queries/household";
import { listInvites } from "@/db/queries/invites";
import { requireScope, requireSession } from "@/lib/auth/session";

import { HouseholdScreen } from "./household-screen";

/**
 * The signed-in household page.
 *
 * Every query below takes the scope from `requireScope()`, which derives it
 * from the session row — there is no id in the URL for any of this, and no way
 * to ask for another household's.
 */
export default async function HouseholdPage() {
  const session = await requireSession();
  const scope = await requireScope();

  const [household, members, invites] = await Promise.all([
    findHousehold(scope),
    listMembers(scope),
    listInvites(scope),
  ]);

  return (
    <HouseholdScreen
      householdName={household?.name}
      email={session.email}
      currentUserId={session.userId}
      members={members}
      invites={invites}
    />
  );
}
