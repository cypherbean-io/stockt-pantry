import type { ReactElement } from "react";

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
  return (
    <>
      <PageHeader title={householdName ?? "Household"} description={`Signed in as ${email}.`} />

      <div className="flex flex-col gap-8">
        <Section title="Members">
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
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Invites"
          description="Anyone with an open invite link can join this household and see its pantry and recipes."
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
