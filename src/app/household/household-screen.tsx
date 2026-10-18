import type { ReactElement } from "react";

import { removeMemberAction, revokeInviteAction } from "@/app/actions/auth";
import { Button } from "@/app/_components/ui/button";
import { DataTable } from "@/app/_components/ui/data-table";
import { PageHeader } from "@/app/_components/ui/page-header";
import { Section } from "@/app/_components/ui/section";
import type { Member } from "@/db/queries/household";
import type { InviteListing } from "@/db/queries/invites";

import { InviteButton } from "./invite-button";

/**
 * What `/household` shows, given what `page.tsx` has already read. Split from
 * the page as `Header` is from `AppShell`, so the markup renders in a test
 * without a database or a request.
 */
export function HouseholdScreen({
  householdName,
  email,
  currentUserId,
  members,
  invites,
}: {
  /** `findHousehold` answers `HouseholdRow | undefined`, so this may be absent. */
  readonly householdName?: string;
  readonly email: string;
  readonly currentUserId: string;
  readonly members: readonly Member[];
  readonly invites: readonly InviteListing[];
}): ReactElement {
  // Who may be removed is the action's call (`deleteMember`: only members who
  // joined after you); this only decides which buttons to draw. A `Date` keeps
  // milliseconds where Postgres keeps microseconds, so two members who joined
  // in the same millisecond rank level here — which hides a button the action
  // would have honoured, never the reverse.
  const you = members.find((member) => member.id === currentUserId);
  const removable = (member: Member) =>
    you !== undefined && member.createdAt.getTime() > you.createdAt.getTime();

  return (
    <>
      <PageHeader title={householdName ?? "Household"} description={`Signed in as ${email}.`} />

      <div className="flex flex-col gap-8">
        <Section title="Members" description="You can remove anyone who joined after you.">
          <ul className="divide-y divide-border rounded-card border border-border bg-surface-raised">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3"
              >
                {/* An address is one long word; let it break rather than overflow. */}
                <span className="min-w-0 text-ink wrap-anywhere">{member.email}</span>
                {member.id === currentUserId && (
                  <span className="text-sm text-ink-muted">(you)</span>
                )}
                {removable(member) && <RemoveMember member={member} />}
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Invites"
          description="Anyone with an open invite link can join this household and see its pantry and recipes. Revoke a link you no longer want honoured."
        >
          <div className="flex flex-col gap-4">
            <InviteButton />

            {invites.length > 0 && (
              <DataTable
                label="Invites"
                rows={invites}
                rowKey={({ id }) => id}
                columns={[
                  { header: "Issued", cell: ({ createdAt }) => createdAt.toLocaleDateString() },
                  { header: "Expires", cell: ({ expiresAt }) => expiresAt.toLocaleDateString() },
                  // Computed by Postgres, so it cannot disagree with what
                  // redemption decides on submit.
                  { header: "Status", cell: ({ status }) => status },
                  {
                    header: "Action",
                    // Only an open invite still lets anyone in. Revoking a used
                    // one would not un-join anybody — removing the member does.
                    cell: ({ id, status }) =>
                      status === "open" && (
                        <form action={revokeInviteAction}>
                          <input type="hidden" name="inviteId" value={id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Revoke
                          </Button>
                        </form>
                      ),
                  },
                ]}
              />
            )}
          </div>
        </Section>
      </div>
      {/*
        The <h2>Session</h2> sign-out form that used to close this page is
        gone. SPEC.md §1 names "Sign out exists in exactly one place" as a
        defect, and §3.3's fix is the account disclosure in the shell — which
        is on every screen, including this one. Two of them would just be two.
      */}
    </>
  );
}

/**
 * Behind a disclosure, as deleting a recipe is, so removing someone is two
 * deliberate presses rather than one stray one. `w-full` puts it on its own
 * line under the address in the row's wrapping flex.
 *
 * The hidden id says only *who* is to go. Who is asking comes off the session
 * inside the action, which also refuses the caller themselves and anyone who
 * joined before them — this is not drawn for those, but the action does not
 * rely on that.
 */
function RemoveMember({ member }: { readonly member: Member }): ReactElement {
  return (
    <details className="w-full rounded-card border border-border">
      <summary
        className={
          "min-h-tap cursor-pointer rounded-card px-4 py-2.5 font-medium text-ink " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        }
      >
        Remove
      </summary>
      <form
        action={removeMemberAction}
        className="flex flex-col items-start gap-3 border-t border-border p-4"
      >
        <input type="hidden" name="memberId" value={member.id} />
        <p className="text-sm text-ink-muted">
          They are signed out everywhere and their account is deleted, along with any invites
          they issued. The pantry and recipes stay. To bring them back, send a new invite.
        </p>
        <Button type="submit" variant="danger" className="wrap-anywhere">
          Yes, remove {member.email}
        </Button>
      </form>
    </details>
  );
}
