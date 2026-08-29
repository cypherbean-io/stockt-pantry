/**
 * Extract a `schema.org/Recipe` from a fetched page (SPEC.md §3 step 2).
 *
 * JSON-LD only. A page without a Recipe block is an explicit failure — there is
 * deliberately no HTML-scraping fallback in v1 (SPEC.md §3, Alternatives
 * rejected), so nothing here guesses at markup.
 */

export type ParsedRecipe = {
  readonly name: string;
  /** Raw `recipeIngredient` strings; parsing them is `parse-line.ts`'s job. */
  readonly ingredientLines: readonly string[];
  readonly steps: readonly string[];
  readonly recipeYield: string | null;
};

export type JsonLdFailure = {
  readonly reason:
    | "no-jsonld"
    | "no-recipe"
    | "recipe-without-ingredients"
    | "recipe-too-large";
};

export type ExtractResult =
  | { readonly ok: true; readonly recipe: ParsedRecipe }
  | { readonly ok: false; readonly failure: JsonLdFailure };

const TYPE_ATTR_RE = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** Guards against a pathologically nested document walking us into a stack overflow. */
const MAX_DEPTH = 12;

/**
 * Caps on what one page may claim. The review screen renders a row per
 * ingredient line, so an unbounded list is a denial of service against the
 * person confirming the import as much as against the server.
 */
const MAX_INGREDIENT_LINES = 200;
const MAX_STEPS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Find the `<script type="application/ld+json">` payloads.
 *
 * Deliberately an indexOf scan rather than a regex. The obvious pattern —
 * `/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/g` — backtracks quadratically on a
 * page full of unterminated `<script` fragments: measured 2.5s at 128KB and
 * minutes at the fetcher's 2MB cap, all of it blocking the event loop. This
 * scan only ever moves forward.
 */
function ldJsonBlocks(html: string): readonly string[] {
  const blocks: string[] = [];

  // Case-insensitive literals, matched against the original string. Scanning a
  // lowercased copy instead would be wrong: toLowerCase is not length
  // preserving ("İ" becomes two chars), which desynchronises every later index.
  const open = /<script/gi;
  const close = /<\/script/gi;

  for (let match = open.exec(html); match !== null; match = open.exec(html)) {
    const tagStart = match.index;
    const nameEnd = tagStart + "<script".length;

    // "<scriptx" is not a script element; skip it without losing our place.
    const following = html[nameEnd];
    if (following !== undefined && !/[\s/>]/.test(following)) continue;

    const tagEnd = html.indexOf(">", nameEnd);
    if (tagEnd === -1) break; // Truncated tag: nothing usable after it.

    const bodyStart = tagEnd + 1;
    close.lastIndex = bodyStart;
    const closing = close.exec(html);
    if (closing === null) break; // Unclosed: no payload to read.

    const typeMatch = TYPE_ATTR_RE.exec(html.slice(nameEnd, tagEnd));
    const declared = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();

    if (declared === "application/ld+json") {
      blocks.push(html.slice(bodyStart, closing.index));
    }

    open.lastIndex = closing.index + "</script".length;
  }

  return blocks;
}

function parseBlock(block: string): unknown {
  // Some sites wrap the payload in an HTML comment or a CDATA section.
  const cleaned = block
    .trim()
    .replace(/^<!--/, "")
    .replace(/-->$/, "")
    .replace(/^\/\/\s*<!\[CDATA\[/, "")
    .replace(/\/\/\s*\]\]>$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}

function isRecipeNode(node: Record<string, unknown>): boolean {
  const declared = node["@type"];
  const types = Array.isArray(declared) ? declared : [declared];

  return types.some(
    (type) =>
      typeof type === "string" &&
      type.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase() === "recipe",
  );
}

/** Depth-first walk; recipes turn up nested under @graph, mainEntity, and friends. */
function findRecipeNode(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > MAX_DEPTH) return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRecipeNode(entry, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;
  if (isRecipeNode(value)) return value;

  for (const child of Object.values(value)) {
    const found = findRecipeNode(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function toStringList(value: unknown): readonly string[] {
  const entries = Array.isArray(value) ? value : [value];

  return entries
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function toSteps(value: unknown, depth = 0): readonly string[] {
  if (depth > MAX_DEPTH) return [];

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => toSteps(entry, depth + 1));
  }

  if (isRecord(value)) {
    // A HowToSection groups its steps; flatten it into the ordered step list.
    if (value.itemListElement !== undefined) return toSteps(value.itemListElement, depth + 1);

    const text = value.text ?? value.name;
    return typeof text === "string" && text.trim() !== "" ? [text.trim()] : [];
  }

  return [];
}

function toYield(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;

  if (typeof first === "string" && first.trim() !== "") return first.trim();
  if (typeof first === "number" && Number.isFinite(first)) return String(first);
  return null;
}

export function extractRecipe(html: string): ExtractResult {
  const blocks = ldJsonBlocks(html);
  if (blocks.length === 0) return { ok: false, failure: { reason: "no-jsonld" } };

  for (const block of blocks) {
    // An unparseable block is skipped, not fatal — pages often carry several.
    const node = findRecipeNode(parseBlock(block));
    if (node === null) continue;

    const ingredientLines = toStringList(node.recipeIngredient);
    if (ingredientLines.length === 0) {
      return { ok: false, failure: { reason: "recipe-without-ingredients" } };
    }

    const steps = toSteps(node.recipeInstructions);
    // Fail loudly rather than truncating: a silently shortened ingredient list
    // would be confirmed by the user as if it were the whole recipe.
    if (ingredientLines.length > MAX_INGREDIENT_LINES || steps.length > MAX_STEPS) {
      return { ok: false, failure: { reason: "recipe-too-large" } };
    }

    return {
      ok: true,
      recipe: {
        name: typeof node.name === "string" ? node.name.trim() : "",
        ingredientLines,
        steps,
        recipeYield: toYield(node.recipeYield),
      },
    };
  }

  return { ok: false, failure: { reason: "no-recipe" } };
}
