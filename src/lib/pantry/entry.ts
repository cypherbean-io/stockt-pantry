import type { FieldErrors, Parsed } from "@/lib/forms";
import { isUnitKey, type UnitKey } from "@/lib/matching/units";

/**
 * Input rules for the pantry forms (SPEC.md §2, "Pantry inventory": a
 * per-household list of (ingredient, quantity, unit), and nothing else).
 *
 * Pure: nothing here touches the database or the session, so the whole surface
 * is exhaustively testable without either. The scope check lives one layer up,
 * in `service.ts` — this module decides only whether the *shape* of what was
 * submitted is usable.
 *
 * A server action is a public POST endpoint, not a private channel from the
 * page that rendered the form, so every field is treated as arbitrary.
 */

export const MAX_INGREDIENT_NAME_LENGTH = 100;

/** The `<select>` value meaning "use the name in the text field, not an id". */
export const NEW_INGREDIENT = "new";

/**
 * Deliberately a second copy of the pattern in `src/db/scope.ts` rather than an
 * export of it. That one guards scope construction and is private so its call
 * sites stay countable; this one guards ids that arrive from a form. Merging
 * them would make "which ids has the user supplied" harder to answer, not
 * easier.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IngredientChoice =
  | { readonly kind: "existing"; readonly id: string }
  | { readonly kind: "new"; readonly name: string; readonly densityGPerMl?: number };

export type PantryAmount = {
  readonly quantity: number;
  readonly unitId: UnitKey;
};

export type PantryEntryDraft = PantryAmount & {
  readonly ingredient: IngredientChoice;
};

export type PantryEntryInput = {
  readonly ingredientId: unknown;
  readonly ingredientName: unknown;
  readonly densityGPerMl: unknown;
  readonly quantity: unknown;
  readonly unitId: unknown;
};

/** An omitted field and an empty one mean the same thing: nothing was said. */
function isBlank(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

/**
 * A finite number strictly greater than zero, or `undefined` if the input is
 * not one.
 *
 * `Number.isFinite` is the load-bearing part, and the blank check ahead of it
 * matters just as much: `Number("")` is 0, `Number("Infinity")` is `Infinity`,
 * and Postgres stores both quite happily on a `double precision` column that
 * only says `> 0` (see `positiveFinite` in `src/db/schema.ts`). A stored
 * `Infinity` makes every recipe report makeable off an empty pantry.
 */
function positiveNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  const text = value.trim();
  if (text === "") return undefined;

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function ingredientNameError(value: unknown): string | undefined {
  if (typeof value !== "string") return "Name the ingredient.";

  const name = value.trim();
  if (name === "") return "Name the ingredient.";
  if (name.length > MAX_INGREDIENT_NAME_LENGTH) {
    return `Use at most ${MAX_INGREDIENT_NAME_LENGTH} characters.`;
  }
  /**
   * Control and format characters, which `trim()` misses in the middle of a
   * string. U+0000 is the one that matters: Postgres cannot store a NUL in a
   * `text` column and rejects the whole statement with SQLSTATE 22021, which
   * would escape a form as a 500 rather than as a field error. The invisible
   * formatting characters go with it — a catalog name that does not render as
   * what it is has no legitimate use.
   */
  if (/[\p{Cc}\p{Cf}]/u.test(name)) {
    return "An ingredient name cannot contain control characters.";
  }
  return undefined;
}

/**
 * Which catalog entry the row is about: one already in the household's
 * catalog, or one to create from the name given.
 *
 * The density is read only on the "new" branch. v1 has no surface for editing
 * an existing ingredient's density (SPEC.md §2, Out), and a field a crafted
 * POST could set would be exactly that surface.
 */
function parseIngredientChoice(input: PantryEntryInput): Parsed<IngredientChoice> {
  if (input.ingredientId === NEW_INGREDIENT) {
    const errors: Record<string, string> = {};

    const nameError = ingredientNameError(input.ingredientName);
    if (nameError !== undefined) errors.ingredientName = nameError;

    let densityGPerMl: number | undefined;
    if (!isBlank(input.densityGPerMl)) {
      densityGPerMl = positiveNumber(input.densityGPerMl);
      if (densityGPerMl === undefined) {
        errors.densityGPerMl = "Enter a density in g/mL above zero, or leave it blank.";
      }
    }

    if (Object.keys(errors).length > 0) return { ok: false, errors };

    return {
      ok: true,
      value: {
        kind: "new",
        name: (input.ingredientName as string).trim(),
        // Spread rather than an explicit `undefined`, so "no density given"
        // stays a missing property rather than a present one holding nothing.
        ...(densityGPerMl === undefined ? {} : { densityGPerMl }),
      },
    };
  }

  if (typeof input.ingredientId === "string" && UUID.test(input.ingredientId)) {
    return { ok: true, value: { kind: "existing", id: input.ingredientId } };
  }

  // Covers the empty select, a missing field, and a malformed id alike. The
  // `uuid` column would reject the last one with SQLSTATE 22P02, and that error
  // carries the bound values, which must never be logged (CLAUDE.md).
  return { ok: false, errors: { ingredientId: "Choose an ingredient, or add a new one." } };
}

/** The (quantity, unit) pair every pantry row and every edit to one carries. */
export function parsePantryAmount(input: {
  readonly quantity: unknown;
  readonly unitId: unknown;
}): Parsed<PantryAmount> {
  const quantity = positiveNumber(input.quantity);
  const unitId = isUnitKey(input.unitId) ? input.unitId : undefined;

  const errors: Record<string, string> = {};
  if (quantity === undefined) errors.quantity = "Enter an amount above zero.";
  if (unitId === undefined) errors.unitId = "Choose a unit.";

  // Every bad field at once — reporting one per submission turns a two-mistake
  // form into two round trips.
  if (quantity === undefined || unitId === undefined) return { ok: false, errors };

  return { ok: true, value: { quantity, unitId } };
}

export function parsePantryEntry(input: PantryEntryInput): Parsed<PantryEntryDraft> {
  const ingredient = parseIngredientChoice(input);
  const amount = parsePantryAmount(input);

  if (!ingredient.ok || !amount.ok) {
    const errors: FieldErrors = {
      ...(ingredient.ok ? {} : ingredient.errors),
      ...(amount.ok ? {} : amount.errors),
    };
    return { ok: false, errors };
  }

  return { ok: true, value: { ingredient: ingredient.value, ...amount.value } };
}

/**
 * A pantry row id on its way to a `uuid` column.
 *
 * The message says the same thing for a malformed id, an id from another
 * household and an id that has been deleted, because the layers below answer
 * those identically too (`src/db/queries/pantry.ts`) — a more specific message
 * here would be an oracle for which ids are real.
 */
export function parsePantryItemId(value: unknown): Parsed<string> {
  if (typeof value !== "string" || !UUID.test(value)) {
    return { ok: false, errors: { id: "That pantry item is no longer there." } };
  }
  return { ok: true, value };
}
