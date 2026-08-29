import type { Unit } from "@/lib/matching/units";
import { UNITS } from "@/lib/matching/units";

/**
 * Best-effort parse of one `recipeIngredient` string into (quantity, unit,
 * name) — SPEC.md §3 step 3.
 *
 * "Best-effort" is load-bearing: this feeds the review-and-confirm screen, not
 * the database. Anything it can't read confidently comes back flagged so the
 * user has to look at it, never silently defaulted (SPEC.md §5).
 */

export type LineConfidence = "high" | "medium" | "low";

export type ParsedIngredientLine = {
  /** The source string, untouched, so the review screen can show it. */
  readonly raw: string;
  readonly quantity: number | null;
  readonly unit: Unit | null;
  readonly name: string;
  readonly confidence: LineConfidence;
};

/** Spelling variants seen in the wild, mapped onto the canonical unit table. */
const UNIT_WORDS: Readonly<Record<string, Unit>> = {
  c: UNITS.cup,
  cup: UNITS.cup,
  cups: UNITS.cup,
  tbsp: UNITS.tbsp,
  tbs: UNITS.tbsp,
  tablespoon: UNITS.tbsp,
  tablespoons: UNITS.tbsp,
  tsp: UNITS.tsp,
  teaspoon: UNITS.tsp,
  teaspoons: UNITS.tsp,
  g: UNITS.g,
  gr: UNITS.g,
  gram: UNITS.g,
  grams: UNITS.g,
  gramme: UNITS.g,
  grammes: UNITS.g,
  kg: UNITS.kg,
  kilogram: UNITS.kg,
  kilograms: UNITS.kg,
  kilo: UNITS.kg,
  kilos: UNITS.kg,
  oz: UNITS.oz,
  ounce: UNITS.oz,
  ounces: UNITS.oz,
  lb: UNITS.lb,
  lbs: UNITS.lb,
  pound: UNITS.lb,
  pounds: UNITS.lb,
  ml: UNITS.ml,
  milliliter: UNITS.ml,
  milliliters: UNITS.ml,
  millilitre: UNITS.ml,
  millilitres: UNITS.ml,
  l: UNITS.l,
  liter: UNITS.l,
  liters: UNITS.l,
  litre: UNITS.l,
  litres: UNITS.l,
};

const VULGAR_FRACTIONS: Readonly<Record<string, number>> = {
  "¼": 1 / 4,
  "½": 1 / 2,
  "¾": 3 / 4,
  "⅐": 1 / 7,
  "⅑": 1 / 9,
  "⅒": 1 / 10,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 1 / 5,
  "⅖": 2 / 5,
  "⅗": 3 / 5,
  "⅘": 4 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const ASCII_FRACTION = String.raw`\d+\s*/\s*\d+`;
const VULGAR = "[\\u00bc-\\u00be\\u2150-\\u215e]";

/**
 * Longest form first: "1 1/2" and "2¼" must win over the bare "1"/"2" they
 * start with. The optional trailing group catches ranges like "2-3".
 */
const QUANTITY_RE = new RegExp(
  `^(${NUMBER}\\s+${ASCII_FRACTION}|${NUMBER}\\s*${VULGAR}|${ASCII_FRACTION}|${VULGAR}|${NUMBER})` +
    `(\\s*(?:-|–|—|to)\\s*(?:${ASCII_FRACTION}|${NUMBER}))?`,
);

const UNIT_WORD_RE = /^([a-zA-Z]+\.?)(?=\s|$)/;

function numericValue(token: string): number | null {
  const compact = token.trim();

  const vulgarMatch = compact.match(new RegExp(`^(${NUMBER})?\\s*(${VULGAR})$`));
  if (vulgarMatch !== null) {
    const whole = vulgarMatch[1] === undefined ? 0 : Number(vulgarMatch[1]);
    const fraction = VULGAR_FRACTIONS[vulgarMatch[2] ?? ""];
    return fraction === undefined ? null : whole + fraction;
  }

  const mixedMatch = compact.match(new RegExp(`^(?:(${NUMBER})\\s+)?(\\d+)\\s*/\\s*(\\d+)$`));
  if (mixedMatch !== null) {
    const whole = mixedMatch[1] === undefined ? 0 : Number(mixedMatch[1]);
    const numerator = Number(mixedMatch[2]);
    const denominator = Number(mixedMatch[3]);
    if (denominator === 0) return null;
    return whole + numerator / denominator;
  }

  const value = Number(compact);
  return Number.isFinite(value) ? value : null;
}

export function parseIngredientLine(raw: string): ParsedIngredientLine {
  const trimmed = raw.trim();

  const quantityMatch = QUANTITY_RE.exec(trimmed);
  if (quantityMatch === null) {
    // "a pinch of salt" — nothing to scale, so the user has to say what it means.
    return { raw, quantity: null, unit: null, name: trimmed, confidence: "low" };
  }

  const quantity = numericValue(quantityMatch[1] ?? "");
  if (quantity === null) {
    return { raw, quantity: null, unit: null, name: trimmed, confidence: "low" };
  }

  const isRange = quantityMatch[2] !== undefined;
  let rest = trimmed.slice(quantityMatch[0].length).trimStart();

  const unitMatch = UNIT_WORD_RE.exec(rest);
  const unitWord = unitMatch?.[1]?.replace(/\.$/, "").toLowerCase() ?? "";
  const unit = UNIT_WORDS[unitWord];

  if (unit !== undefined) {
    rest = rest.slice(unitMatch?.[0].length ?? 0).trimStart();
  }

  // "1 cup of milk" — the filler word is not part of the ingredient name.
  rest = rest.replace(/^of\s+/i, "");

  const confidence: LineConfidence = isRange ? "low" : unit !== undefined ? "high" : "medium";

  return {
    raw,
    quantity,
    // No unit word means a count of whole items ("3 large eggs"), which is an
    // inference — hence "medium" above, never "high".
    unit: unit ?? UNITS.count,
    name: rest.trim(),
    confidence,
  };
}
