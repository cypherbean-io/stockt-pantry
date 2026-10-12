import Link from "next/link";
import type { ReactElement } from "react";

import { PlusIcon } from "@/app/_components/icons";
import { LinkButton } from "@/app/_components/ui/button";
import { DataTable } from "@/app/_components/ui/data-table";
import { EmptyState } from "@/app/_components/ui/empty-state";
import { PageHeader } from "@/app/_components/ui/page-header";
import { summarise } from "@/lib/matching/summary";
import type { MatchResult } from "@/lib/matching/types";

/**
 * What `/recipes` shows, given what `page.tsx` has already read and matched.
 *
 * Split from the page the way `Header` is split from `AppShell`: the page
 * holds the session check and the queries, and this holds the markup, so the
 * markup can be rendered in a test without a database or a request.
 */

export type RecipeListEntry = {
  readonly id: string;
  readonly name: string;
  readonly baseServings: number;
  readonly result: MatchResult;
};

/**
 * A recipe's name, as the way into it. Tap-sized like every other target
 * (SPEC.md §2 item 9) — this is the most-pressed link in the app — and in
 * `--accent`, which `tokens.test.ts` measures as link text on both surfaces.
 */
const RECIPE_LINK =
  "inline-flex min-h-tap min-w-tap items-center rounded-control font-medium text-accent " +
  "underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-focus";

export function RecipeListScreen({
  entries,
  pantryIsEmpty,
}: {
  /** In display order: `page.tsx` lifts the makeable ones to the top. */
  readonly entries: readonly RecipeListEntry[];
  readonly pantryIsEmpty: boolean;
}): ReactElement {
  return (
    <>
      {/*
        The `·`-separated link line that used to sit here is gone (SPEC.md
        §3.3): Pantry and Household are navigation and live in the shell now.
        What is left is contextual — two things to do with recipes — so it goes
        in the page header's action slot rather than pretending to be a nav.
      */}
      <PageHeader
        title="What can I make?"
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/recipes/new" variant="secondary" size="sm">
              Add a recipe
            </LinkButton>
            <LinkButton href="/recipes/import" variant="secondary" size="sm">
              Import from a URL
            </LinkButton>
          </div>
        }
      />

      {pantryIsEmpty && (
        // `--status-warn`, with its own ink: an empty pantry is not an error,
        // but it does make every row below read as "missing everything", and
        // that is worth explaining before anyone believes it.
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card bg-status-warn px-4 py-3 text-status-warn-ink">
          <p className="max-w-prose">
            <strong className="font-semibold">The pantry is empty.</strong> Until it has something
            in it, every recipe here will read as missing every ingredient.
          </p>
          <LinkButton href="/pantry" variant="secondary" size="sm">
            Add what you have
          </LinkButton>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<PlusIcon />}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/recipes/new">Add the first one</LinkButton>
              <LinkButton href="/recipes/import" variant="secondary">
                Import one from a URL
              </LinkButton>
            </div>
          }
        >
          No recipes yet.
        </EmptyState>
      ) : (
        <DataTable
          label="Recipes"
          rows={entries}
          rowKey={({ id }) => id}
          rowHeader={{
            header: "Recipe",
            cell: ({ id, name }) => (
              <Link href={`/recipes/${id}`} className={RECIPE_LINK}>
                {name}
              </Link>
            ),
          }}
          columns={[
            { header: "Serves", cell: ({ baseServings }) => baseServings },
            { header: "Status", cell: ({ result }) => summarise(result) },
          ]}
        />
      )}
    </>
  );
}
