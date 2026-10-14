import { round, shoppingListText } from "@/lib/matching/format";
import type { MatchResult, MatchedLine } from "@/lib/matching/types";

import { CopyButton } from "./copy-button";
import { StatusBadge } from "./ui/badge";
import { DataTable } from "./ui/data-table";

/**
 * Rendering for a match result.
 *
 * The three not-makeable statuses are deliberately not collapsed into one
 * (SPEC.md §3 step 5): "missing" and "short" are fixed by buying something,
 * "unresolved" is fixed by knowing the ingredient's density. A user who cannot
 * tell them apart cannot tell which of those to go and do.
 *
 * The status wording moved to `ui/badge.tsx` with the component vocabulary
 * (SPEC.md §3.6) — that is what paints it, and a second copy of a
 * user-visible string is a copy that drifts.
 *
 * `summarise` moved to `src/lib/matching/summary.ts` with the four-bucket
 * classifier (SPEC.md §3.5): it describes a match result rather than paints
 * one, so it belongs with the pure, exhaustively-tested matching logic.
 * `round` went to `src/lib/matching/format.ts` for the same reason, beside the
 * shopping list's plain-text form, so the page and the copy agree.
 */

/**
 * A `DataTable`, so below `sm` each line is a card (SPEC.md §3.6), and the
 * status is a `StatusBadge` — token, glyph and words — rather than the words
 * alone in a cell the same weight as the ingredient's name.
 */
export function MatchTable({ result }: { result: MatchResult }) {
  if (result.lines.length === 0) {
    return <p className="text-ink-muted">This recipe has no ingredients listed.</p>;
  }

  return (
    <DataTable
      label="Ingredients against the pantry"
      rows={result.lines}
      rowKey={(line) => line.ingredient.id}
      rowHeader={{ header: "Ingredient", cell: (line) => line.ingredient.name }}
      columns={[
        {
          header: "Needed",
          cell: (line) => `${round(line.required.value)} ${line.required.unit.name}`,
        },
        {
          header: "Have (in the recipe’s unit)",
          cell: (line) => (line.available === null ? "—" : round(line.available)),
        },
        { header: "Status", cell: (line) => <StatusBadge status={line.status} /> },
      ]}
    />
  );
}

/**
 * Read-only output, and it stays that way: checking something off here never
 * writes to `pantry_item` (SPEC.md §3, an explicit v1 scope cut). Copy reads
 * the list and nothing else (SPEC.md §3.8).
 */
export function ShoppingList({
  recipeName,
  servings,
  lines,
}: {
  readonly recipeName: string;
  readonly servings: number;
  readonly lines: readonly MatchedLine[];
}) {
  if (lines.length === 0) {
    return <p className="text-ink-muted">Nothing to buy.</p>;
  }

  const text = shoppingListText(recipeName, servings, lines);

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border rounded-card border border-border bg-surface-raised">
        {lines.map((line) => (
          <li
            key={line.ingredient.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
          >
            <span className="text-ink">{line.ingredient.name}</span>
            <span className="font-medium text-ink tabular-nums">
              {round(line.shortfall)} {line.required.unit.name}
            </span>
          </li>
        ))}
      </ul>
      {/* Keyed on the text, so a "Copied" from before a rescale does not
          linger beside a list it was not true of. */}
      <CopyButton key={text} text={text} />
    </div>
  );
}
