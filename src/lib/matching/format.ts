import type { MatchedLine } from "./types";

/**
 * Match results as text — the numbers the page prints and the shopping list
 * the Copy button hands to the clipboard (SPEC.md §3.8).
 *
 * Pure, like the rest of `src/lib/matching/`. `round` moved here from
 * `_components/match.tsx` so the page and the copied text cannot disagree
 * about how many decimal places 2/3 of a cup has.
 */

/** Floats out of a unit conversion are long; nobody needs 402.19999999999993 g. */
export function round(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Anything a paste target may break a line on: C0/C1 controls (LF, CR, NEL…), U+2028, U+2029. */
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** Invisible format characters — zero-width spaces, bidi overrides — that hide or reorder text. */
const INVISIBLE = /\p{Cf}/gu;

/**
 * A name as one visible line. The entry forms' control-character check misses
 * the Unicode line breaks, an imported recipe's names are a third-party page's
 * words, and rows already stored were never checked for them — so this does
 * not trust any of that.
 */
function oneLine(name: string): string {
  return name.replace(INVISIBLE, "").replace(LINE_BREAKING, " ");
}

/**
 * Plain text, not HTML: it goes onto the clipboard and into whatever the user
 * pastes it into, so nothing here is escaped. Every name goes through
 * `oneLine`, so the pasted list has exactly the lines the page shows.
 */
export function shoppingListText(
  recipeName: string,
  servings: number,
  lines: readonly MatchedLine[],
): string {
  const header = `${oneLine(recipeName)} — shopping list (${servings} ${servings === 1 ? "serving" : "servings"})`;
  const items = lines.map(
    (line) =>
      `- ${oneLine(line.ingredient.name)}: ${round(line.shortfall)} ${line.required.unit.name}`,
  );

  return [header, ...items].join("\n");
}
