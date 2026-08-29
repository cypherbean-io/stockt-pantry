/**
 * Data-entry validation for quantities.
 *
 * CLAUDE.md puts this at the data-entry layer on purpose: the matching engine
 * assumes valid input and does no checking of its own. The CHECK constraints in
 * the schema are the backstop, not the control — this runs first so a bad value
 * produces a clear error instead of a SQLSTATE 23514.
 *
 * `Number.isFinite` is the load-bearing part. `NaN` and `Infinity` both survive
 * a naive `value > 0` test in JS *and* in Postgres, where `NaN` sorts above
 * every other float — see the `positiveFinite` note in `schema.ts`.
 */

export function assertPositiveQuantity(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite quantity greater than zero`);
  }
  return value;
}

/** Density is optional; when present it has the same constraints. */
export function assertOptionalDensity(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertPositiveQuantity(value, "Density");
}

export function assertPositiveServings(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Base servings must be a whole number greater than zero");
  }
  return value;
}
