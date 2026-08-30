import { isUnitKey, type UnitKey } from "@/lib/matching/units";

/**
 * The recipe form, parsed and validated.
 *
 * Pure on purpose. A server action is a public POST endpoint — reachable by
 * anyone who can send one, not only by the page that renders the form — so
 * everything the action forwards to the query layer passes through here first,
 * and everything here is exhaustively testable without a database.
 *
 * CLAUDE.md puts quantity validation at the data-entry layer because the
 * matching engine assumes valid input: an `Infinity` quantity that reached the
 * engine would report a recipe makeable off an empty pantry.
 */

export const MAX_NAME_LENGTH = 200;
export const MAX_STEPS = 100;
export const MAX_STEP_LENGTH = 2_000;
export const MAX_LINES = 100;
/** Well past any real recipe, and far enough below float8's range that
 *  scaling by `MAX_SERVINGS` cannot reach Infinity. */
export const MAX_QUANTITY = 1_000_000;
export const MAX_SERVINGS = 999;

/**
 * Density needs a *lower* bound, not just `> 0`.
 *
 * `convert` divides by it for mass->volume, so a density of `1e-300` — which
 * satisfies both `> 0` and the `x > 0 AND x < 'Infinity'` CHECK constraint —
 * turns a real pantry quantity into `Infinity`, and `Infinity >= required`
 * reports every recipe makeable. These bounds are physical: the lightest
 * aerogel is around 0.001 g/mL and osmium, the densest element, is 22.6.
 */
export const MIN_DENSITY = 0.001;
export const MAX_DENSITY = 25;

/**
 * C0 controls and DEL, minus the tab.
 *
 * A NUL byte is the one that matters: Postgres rejects it in `text` outright
 * (SQLSTATE 22021), and by the time the recipe insert reaches it the catalog
 * rows for the other lines have already been committed by their own
 * transactions. Newlines never reach this — they are the step separator and
 * the split consumes them.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000A-\u001F\u007F]/;

export type DraftLine = {
  readonly name: string;
  readonly quantity: number;
  readonly unitId: UnitKey;
  /** Only consulted when the name turns out to be a new catalog entry. */
  readonly densityGPerMl?: number;
};

export type RecipeDraft = {
  readonly name: string;
  readonly baseServings: number;
  readonly steps: readonly string[];
  readonly lines: readonly DraftLine[];
};

/**
 * Keyed by form field, plus `line-<index>` for the repeated ingredient rows
 * and `lines` for problems with the set of them.
 */
export type RecipeFieldErrors = Readonly<Record<string, string>>;

export type ParsedRecipe =
  | { readonly ok: true; readonly value: RecipeDraft }
  | { readonly ok: false; readonly message: string; readonly fieldErrors: RecipeFieldErrors };

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * A non-string entry becomes an empty string rather than disappearing: the
 * four repeated inputs are index-aligned, and dropping one would pair a name
 * with the next row's quantity.
 */
function texts(data: FormData, key: string): string[] {
  return data.getAll(key).map((value) => (typeof value === "string" ? value : ""));
}

function parseSteps(raw: string, errors: Record<string, string>): string[] {
  const steps = raw
    .split(/\r?\n/)
    .map((step) => step.trim())
    .filter((step) => step !== "");

  if (steps.length > MAX_STEPS) {
    errors["steps"] = `Too many steps (${MAX_STEPS} at most).`;
  } else if (steps.some((step) => step.length > MAX_STEP_LENGTH)) {
    errors["steps"] = `One of those steps is too long (${MAX_STEP_LENGTH} characters at most).`;
  } else if (steps.some((step) => CONTROL_CHARS.test(step))) {
    errors["steps"] = "One of those steps contains a character that cannot be stored.";
  }

  return steps;
}

/** `undefined` means the line was rejected; the reason is already in `errors`. */
function parseLine(
  index: number,
  name: string,
  quantity: string,
  unitId: string,
  density: string,
  seen: Set<string>,
  errors: Record<string, string>,
): DraftLine | undefined {
  const key = `line-${index}`;
  const trimmedName = name.trim();

  if (trimmedName === "") {
    errors[key] = "Give this ingredient a name.";
    return undefined;
  }
  if (trimmedName.length > MAX_NAME_LENGTH) {
    errors[key] = `That ingredient name is too long (${MAX_NAME_LENGTH} characters at most).`;
    return undefined;
  }
  if (CONTROL_CHARS.test(trimmedName)) {
    // Caught here rather than left to Postgres: the catalog rows for the other
    // lines commit in their own transactions before the recipe insert runs, so
    // a name the database refuses would leave those behind.
    errors[key] = "That ingredient name contains a character that cannot be stored.";
    return undefined;
  }

  // Only a first pass: the catalog lookup lowercases in SQL, and Postgres
  // `lower()` disagrees with JS on a few codepoints. The unique constraint on
  // (recipe_id, ingredient_id) is what actually enforces this; catching the
  // ordinary case here turns a SQLSTATE into something the form can point at.
  const fingerprint = trimmedName.toLowerCase();
  if (seen.has(fingerprint)) {
    errors[key] = "This ingredient is already on the list.";
    return undefined;
  }

  const parsedQuantity = Number(quantity.trim());
  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    errors[key] = "Quantity must be a number greater than zero.";
    return undefined;
  }
  if (parsedQuantity > MAX_QUANTITY) {
    errors[key] = `Quantity must be ${MAX_QUANTITY} or less.`;
    return undefined;
  }

  if (!isUnitKey(unitId)) {
    errors[key] = "Pick a unit from the list.";
    return undefined;
  }

  const trimmedDensity = density.trim();
  if (trimmedDensity === "") {
    seen.add(fingerprint);
    return { name: trimmedName, quantity: parsedQuantity, unitId };
  }

  const parsedDensity = Number(trimmedDensity);
  if (
    !Number.isFinite(parsedDensity) ||
    parsedDensity < MIN_DENSITY ||
    parsedDensity > MAX_DENSITY
  ) {
    errors[key] = `Density must be between ${MIN_DENSITY} and ${MAX_DENSITY} g/mL, or left blank.`;
    return undefined;
  }

  seen.add(fingerprint);
  return {
    name: trimmedName,
    quantity: parsedQuantity,
    unitId,
    densityGPerMl: parsedDensity,
  };
}

export function parseRecipeForm(data: FormData): ParsedRecipe {
  const errors: Record<string, string> = {};

  const name = text(data, "name").trim();
  if (name === "") {
    errors["name"] = "Give the recipe a name.";
  } else if (name.length > MAX_NAME_LENGTH) {
    errors["name"] = `That name is too long (${MAX_NAME_LENGTH} characters at most).`;
  } else if (CONTROL_CHARS.test(name)) {
    errors["name"] = "That name contains a character that cannot be stored.";
  }

  const baseServings = Number(text(data, "baseServings").trim());
  if (!Number.isInteger(baseServings) || baseServings < 1 || baseServings > MAX_SERVINGS) {
    errors["baseServings"] = `Base servings must be a whole number from 1 to ${MAX_SERVINGS}.`;
  }

  const steps = parseSteps(text(data, "steps"), errors);

  const names = texts(data, "ingredientName");
  const quantities = texts(data, "ingredientQuantity");
  const units = texts(data, "ingredientUnit");
  const densities = texts(data, "ingredientDensity");

  const lines: DraftLine[] = [];
  const seen = new Set<string>();

  if (names.length === 0) {
    errors["lines"] = "Add at least one ingredient.";
  } else if (names.length > MAX_LINES) {
    errors["lines"] = `Too many ingredients (${MAX_LINES} at most).`;
  } else if (
    quantities.length !== names.length ||
    units.length !== names.length ||
    densities.length !== names.length
  ) {
    // Index alignment is the browser's doing, not something the server can
    // reconstruct. Anything else is a submission this form did not produce.
    errors["lines"] = "Those ingredient rows did not arrive intact. Try again.";
  } else {
    for (const [index, lineName] of names.entries()) {
      const line = parseLine(
        index,
        lineName,
        quantities[index] ?? "",
        units[index] ?? "",
        densities[index] ?? "",
        seen,
        errors,
      );
      if (line !== undefined) {
        lines.push(line);
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Check the fields below.", fieldErrors: errors };
  }

  return { ok: true, value: { name, baseServings, steps, lines } };
}

/**
 * The serving count from `?servings=`.
 *
 * A URL someone typed by hand is not worth a 500, so anything unusable falls
 * back to the recipe's own count rather than reaching the engine and scaling
 * every quantity by NaN. The cap keeps `quantity * scale` finite.
 */
export function parseServings(raw: string | undefined, baseServings: number): number {
  if (raw === undefined) {
    return baseServings;
  }

  const value = Number(raw.trim());
  if (raw.trim() === "" || !Number.isInteger(value) || value < 1 || value > MAX_SERVINGS) {
    return baseServings;
  }
  return value;
}
