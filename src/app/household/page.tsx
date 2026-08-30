import Link from "next/link";

import { logOutAction } from "@/app/actions/auth";
import { findHousehold, listMembers } from "@/db/queries/household";
import { listInvites } from "@/db/queries/invites";
import { requireScope, requireSession } from "@/lib/auth/session";

import { InviteButton } from "./invite-button";

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
    <main>
      <h1>{household?.name ?? "Household"}</h1>
      <p>
        Signed in as {session.email}. <Link href="/">Pantry</Link>
      </p>

      <h2>Members</h2>
      <ul>
        {members.map((member) => (
          <li key={member.id}>
            {member.email}
            {member.id === session.userId && " (you)"}
          </li>
        ))}
      </ul>

      <h2>Invites</h2>
      <p>
        Anyone with an open invite link can join this household and see its pantry and recipes.
      </p>
      <InviteButton />

      {invites.length > 0 && (
        <table>
          <thead>
            <tr>
              <th align="left">Issued</th>
              <th align="left">Expires</th>
              <th align="left">Status</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => (
              <tr key={invite.id}>
                <td>{invite.createdAt.toLocaleDateString()}</td>
                <td>{invite.expiresAt.toLocaleDateString()}</td>
                {/* Computed by Postgres, so it cannot disagree with what
                    redemption decides on submit. */}
                <td>{invite.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Session</h2>
      <form action={logOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
