import type { ParsedRecipe } from "@/lib/import/jsonld";
import { parseIngredientLine, type LineConfidence } from "@/lib/import/parse-line";
import { unitKeyOf, type UnitKey } from "@/lib/matching/units";

import { MAX_LINES, MAX_SERVINGS, MAX_STEPS } from "./form";

/**
 * The review-and-confirm step of a URL import (SPEC.md §3 step 4): turn what
 * was parsed off a page into the form a person is asked to check.
 *
 * Pure, and deliberately so — this is the layer that decides what someone is
 * shown and clicks "save" on, which makes it worth testing exhaustively without
 * a network or a database. It produces *form* values (strings), not a
 * `RecipeDraft`: nothing here is trusted on the way back in, and everything the
 * user confirms is re-parsed by `parseRecipeForm` before it reaches a query.
 *
 * Nothing here writes anything. SPEC.md §3 step 5 is explicit that no row from
 * a fetch is persisted before the user confirms it.
 */

/**
 * What the servings field starts at when the page did not say. It is a guess,
 * so `servingsStated` is false and the review screen says as much — the field
 * is the user's to correct before saving.
 */
export const DEFAULT_SERVINGS = 4;

/**
 * Kitchen precision. `1/3 cup` parses to 0.333…, and a quantity box holding
 * seventeen decimal places reads as a bug. Four decimals is finer than any
 * measure a recipe uses, and the user can overwrite it.
 */
const QUANTITY_DECIMALS = 4;

export type ReviewLine = {
  /** The page's own text, kept verbatim so the screen can show what was read. */
  readonly raw: string;
  readonly name: string;
  /** Empty when nothing could be read: the user has to supply it. */
  readonly quantity: string;
  /** Empty when no unit could be read; no unit is preselected in that case. */
  readonly unitId: UnitKey | "";
  readonly confidence: LineConfidence;
  /** True when `name` came from the household's catalog rather than the page. */
  readonly fromCatalog: boolean;
};

export type ImportDraft = {
  readonly sourceUrl: string;
  readonly name: string;
  readonly baseServings: string;
  /** False when `baseServings` is this app's default rather than the page's. */
  readonly servingsStated: boolean;
  /** Newline-separated, matching the form's steps textarea. */
  readonly steps: string;
  readonly lines: readonly ReviewLine[];
};

export type DraftResult =
  | { readonly ok: true; readonly draft: ImportDraft }
  | { readonly ok: false; readonly message: string };

/**
 * Words that are the same ingredient to a cook but different strings to a
 * comparison. Only the mechanical ones — no attempt at a stemmer, and nothing
 * that guesses at meaning.
 */
function normaliseToken(token: string): string {
  // Trailing "s" only, and only when something is left. "eggs" and "egg" are
  // one catalog entry; "gas" and "ga" are not worth the risk. Both sides go
  // through this, so an over-eager strip stays symmetric rather than wrong.
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function tokens(name: string): readonly string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "")
    .map(normaliseToken);
}

function isSubsetOf(inner: readonly string[], outer: ReadonlySet<string>): boolean {
  return inner.every((token) => outer.has(token));
}

type CatalogEntry = {
  readonly name: string;
  readonly tokens: readonly string[];
  readonly unique: ReadonlySet<string>;
};

/**
 * The catalog, tokenised once and bucketed by head token.
 *
 * Both halves are about cost, and both are load-bearing rather than tidying.
 * Tokenising per lookup meant re-tokenising the whole catalog once per
 * ingredient line; bucketing means a lookup only ever compares against entries
 * that could possibly match, since `score` requires the heads to be equal.
 * Without them the work is lines x catalog x tokens, on the request thread of a
 * single-threaded server, with no rate limit in front of the import form — and
 * a household grows its own catalog one confirmed import at a time.
 */
export type CatalogIndex = ReadonlyMap<string, readonly CatalogEntry[]>;

export function indexCatalog(catalog: readonly string[]): CatalogIndex {
  const byHead = new Map<string, CatalogEntry[]>();

  for (const name of catalog) {
    const entryTokens = tokens(name);
    const head = entryTokens[entryTokens.length - 1];
    if (head === undefined) continue;

    const entry: CatalogEntry = { name, tokens: entryTokens, unique: new Set(entryTokens) };
    const bucket = byHead.get(head);
    if (bucket === undefined) byHead.set(head, [entry]);
    else bucket.push(entry);
  }

  return byHead;
}

/**
 * How well a catalog entry matches a parsed ingredient name. Higher is better;
 * zero means no suggestion.
 *
 * Containment, not similarity. A suggestion has to share the *head* of the name
 * — the last token, which in English is the noun the line is about — so
 * "peanut oil" does not land on "peanut butter" merely for sharing a word. A
 * wrong suggestion is worse than none on a screen people click through. The
 * head is what the index buckets on, so by the time this runs it already holds.
 */
function score(
  parsed: readonly string[],
  parsedUnique: ReadonlySet<string>,
  entry: CatalogEntry,
): number {
  if (parsed.length === entry.tokens.length && isSubsetOf(entry.tokens, parsedUnique)) return 3;
  // "all-purpose flour" on a page, "Flour" in the catalog.
  if (isSubsetOf(entry.tokens, parsedUnique)) return 2;
  // "flour" on a page, "All-purpose flour" in the catalog.
  if (isSubsetOf(parsed, entry.unique)) return 1;
  return 0;
}

function bestMatch(parsed: readonly string[], index: CatalogIndex): string | undefined {
  const head = parsed[parsed.length - 1];
  if (head === undefined) return undefined;

  const candidates = index.get(head);
  if (candidates === undefined) return undefined;

  const parsedUnique = new Set(parsed);

  let best: CatalogEntry | undefined;
  let bestScore = 0;

  for (const entry of candidates) {
    const value = score(parsed, parsedUnique, entry);
    if (value === 0) continue;

    // Ties go to the more general entry, then alphabetically, so the same
    // catalog always produces the same suggestion whatever order it arrives in.
    const better =
      value > bestScore ||
      (value === bestScore &&
        best !== undefined &&
        (entry.tokens.length < best.tokens.length ||
          (entry.tokens.length === best.tokens.length && entry.name.localeCompare(best.name) < 0)));

    if (better) {
      best = entry;
      bestScore = value;
    }
  }

  return best?.name;
}

/**
 * The household's own name for what a line is about, if it has one (SPEC.md §3
 * step 4). `undefined` means "create a new catalog entry", which is what the
 * form does with a name it does not recognise.
 *
 * Indexes the catalog on every call, so it is the single-lookup form. A whole
 * recipe goes through `buildImportDraft`, which indexes once.
 */
export function suggestIngredient(
  parsedName: string,
  catalog: readonly string[],
): string | undefined {
  return bestMatch(tokens(parsedName), indexCatalog(catalog));
}

const YIELD_PREFIX =
  /^(?:(?:makes|serves|serving|servings|yield|yields|about|approx\.?|approximately)\s+)+/i;

/**
 * A serving count out of `recipeYield`, or null if the page did not state one
 * this app can use.
 *
 * Only a *leading* number counts. "9x13 inch pan" has a number in it and does
 * not say how many people it feeds, and a silently wrong base-servings figure
 * would rescale every quantity on the recipe afterwards.
 */
export function servingsFromYield(recipeYield: string | null): number | null {
  if (recipeYield === null) return null;

  const digits = /^(\d+)/.exec(recipeYield.trim().replace(YIELD_PREFIX, ""));
  if (digits === null) return null;

  const value = Number(digits[1]);
  // Out of the form's range is not a serving count this app can hold, and
  // clamping it would be a number the page never claimed.
  if (!Number.isInteger(value) || value < 1 || value > MAX_SERVINGS) return null;

  return value;
}

/** Trailing zeros stripped by the round-trip through Number: 0.5000 -> "0.5". */
function formatQuantity(quantity: number | null): string {
  if (quantity === null) return "";
  return String(Number(quantity.toFixed(QUANTITY_DECIMALS)));
}

export function buildImportDraft(
  recipe: ParsedRecipe,
  sourceUrl: string,
  catalog: readonly string[],
): DraftResult {
  // Checked here rather than left to the save: `parseRecipeForm`'s caps are
  // lower than the extractor's, and a review screen the user cannot submit
  // however carefully they fill it in is worse than a refusal up front.
  if (recipe.ingredientLines.length > MAX_LINES) {
    return {
      ok: false,
      message: `That recipe has more ingredients than this app can store (${MAX_LINES} at most).`,
    };
  }
  if (recipe.steps.length > MAX_STEPS) {
    return {
      ok: false,
      message: `That recipe has more steps than this app can store (${MAX_STEPS} at most).`,
    };
  }

  // One catalog entry cannot be the suggestion for two lines: the save rejects
  // a recipe naming the same ingredient twice, and the second line's own text
  // is the better starting point anyway ("bread flour" beside "Flour").
  const taken = new Set<string>();

  // Once for the whole recipe, not once per line.
  const index = indexCatalog(catalog);

  const lines = recipe.ingredientLines.map((raw): ReviewLine => {
    const parsed = parseIngredientLine(raw);
    const suggestion = bestMatch(tokens(parsed.name), index);
    const fromCatalog = suggestion !== undefined && !taken.has(suggestion);
    if (fromCatalog) taken.add(suggestion);

    return {
      raw,
      name: fromCatalog ? suggestion : parsed.name,
      quantity: formatQuantity(parsed.quantity),
      // `parse-line` returns the unit itself; the form field wants its id, and
      // a line with no unit gets none — the user picks one.
      unitId: parsed.unit === null ? "" : (unitKeyOf(parsed.unit) ?? ""),
      confidence: parsed.confidence,
      fromCatalog,
    };
  });

  const stated = servingsFromYield(recipe.recipeYield);

  return {
    ok: true,
    draft: {
      sourceUrl,
      // Over-long text is left as it is rather than truncated: the review
      // screen is editable, `parseRecipeForm` will point at the field, and
      // silently shortening a recipe the user is about to confirm is worse
      // than asking them to shorten it.
      name: recipe.name,
      baseServings: String(stated ?? DEFAULT_SERVINGS),
      servingsStated: stated !== null,
      steps: recipe.steps.join("\n"),
      lines,
    },
  };
}
