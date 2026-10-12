import type { LineStatus, MatchResult } from "./types";

/**
 * The four buckets `/recipes` groups recipes under, and the one line of text
 * each row carries (SPEC.md §3.5).
 *
 * Pure, like the rest of `src/lib/matching/`: no React and no database, so it
 * can be tested exhaustively. `summarise` moved here from
 * `_components/match.tsx` — it is a statement about a match result, not about
 * how one is painted.
 */

/**
 * Display order, most actionable first. It is also where the bucket vocabulary
 * is defined, so the order cannot leave a bucket out.
 */
export const BUCKET_ORDER = ["ready", "shopping", "partly-unverifiable", "unverifiable"] as const;

export type RecipeBucket = (typeof BUCKET_ORDER)[number];

/** A total `Record`: a fifth bucket in `BUCKET_ORDER` fails `tsc` here until it has a heading. */
export const BUCKET_LABEL: Record<RecipeBucket, string> = {
  ready: "Ready to cook",
  shopping: "Needs shopping",
  "partly-unverifiable": "Partly unverifiable",
  unverifiable: "Can't verify",
};

export function countByStatus(result: MatchResult): Record<LineStatus, number> {
  const counts: Record<LineStatus, number> = { have: 0, short: 0, missing: 0, unresolved: 0 };
  for (const line of result.lines) {
    counts[line.status] += 1;
  }
  return counts;
}

/**
 * What stands between a recipe and the stove. "To buy" is missing + short —
 * the lines `shoppingList` would list. "Unresolved" is the lines no purchase
 * can settle, because answering them needs a density.
 */
function blockers(result: MatchResult): { readonly toBuy: number; readonly unresolved: number } {
  const counts = countByStatus(result);
  const toBuy = counts.missing + counts.short;

  // "Ready" has to be a positive finding — every line has enough — and not
  // merely the absence of a blocker this function knows about. A status
  // outside these four, whether out-of-type data or a fifth `LineStatus`
  // nobody sorted into "to buy" or "unresolved" here, would otherwise count as
  // nothing and file an uncookable recipe under Ready to cook.
  if (counts.have + toBuy + counts.unresolved !== result.lines.length) {
    throw new Error("A match line has a status the recipe classifier does not recognise");
  }

  return { toBuy, unresolved: counts.unresolved };
}

/**
 * Derived from the lines alone, never from `result.makeable`, which is what
 * lets a test hold the two against each other: ready if and only if makeable.
 * Written as two counts the function is total — every pair lands in exactly
 * one bucket — so there is no unreachable branch to guess at.
 *
 * Partly unverifiable is its own bucket rather than folded into Needs
 * shopping: the shopping list for it is knowably incomplete, and the user
 * should know that before acting on it (SPEC.md §3.10).
 */
export function recipeBucket(result: MatchResult): RecipeBucket {
  const { toBuy, unresolved } = blockers(result);

  if (unresolved > 0 && toBuy > 0) return "partly-unverifiable";
  if (unresolved > 0) return "unverifiable";
  if (toBuy > 0) return "shopping";
  // Including a recipe with no ingredient lines, which the engine calls
  // makeable too.
  return "ready";
}

/** One line for a recipe in a list, where the per-line table is not shown. */
export function summarise(result: MatchResult): string {
  const { toBuy, unresolved } = blockers(result);

  const parts: string[] = [];
  if (toBuy > 0) parts.push(`${toBuy} to buy`);
  if (unresolved > 0) parts.push(`${unresolved} can't verify`);

  // Empty exactly when the recipe is ready. The old "Not makeable" fallback,
  // for the counts and `makeable` disagreeing, cannot arise now that both
  // readings come from the lines.
  return parts.length === 0 ? BUCKET_LABEL.ready : parts.join(" · ");
}
