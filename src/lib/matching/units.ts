/**
 * Unit table and dimension-aware conversion.
 *
 * Pure logic, no DB (SPEC.md §5). Mirrors the conceptual `unit` table from
 * SPEC.md §3: each unit has a dimension and a factor to that dimension's base
 * unit (mass -> gram, volume -> millilitre, count -> item).
 */

export type Dimension = "mass" | "volume" | "count";

export type Unit = {
  readonly name: string;
  readonly dimension: Dimension;
  /** Multiplier to the dimension's base unit (g, mL, or item). */
  readonly toBase: number;
};

export const UNITS = {
  g: { name: "g", dimension: "mass", toBase: 1 },
  kg: { name: "kg", dimension: "mass", toBase: 1000 },
  oz: { name: "oz", dimension: "mass", toBase: 28.349523125 },
  lb: { name: "lb", dimension: "mass", toBase: 453.59237 },
  ml: { name: "mL", dimension: "volume", toBase: 1 },
  l: { name: "L", dimension: "volume", toBase: 1000 },
  cup: { name: "cup", dimension: "volume", toBase: 236.5882365 },
  tbsp: { name: "tbsp", dimension: "volume", toBase: 14.78676478125 },
  tsp: { name: "tsp", dimension: "volume", toBase: 4.92892159375 },
  count: { name: "count", dimension: "count", toBase: 1 },
} as const satisfies Record<string, Unit>;

export type UnitKey = keyof typeof UNITS;

/**
 * Narrow a string to a unit key.
 *
 * `unit_id` is a text column and a form field is a string, so everything
 * arrives here unnarrowed. The check is `Object.hasOwn` rather than
 * `UNITS[value] !== undefined`, which would answer true for `"constructor"`
 * and hand the caller a function where a unit was expected.
 */
export function isUnitKey(value: string): value is UnitKey {
  return Object.hasOwn(UNITS, value);
}

/** The unit a stored `unit_id` names, or undefined if it names nothing. */
export function unitById(id: string): Unit | undefined {
  return isUnitKey(id) ? UNITS[id] : undefined;
}

/**
 * Convert `value` from one unit to another.
 *
 * Same-dimension conversions always resolve. Mass<->volume needs the
 * ingredient's density; without it the caller must surface "unresolved" rather
 * than guessing (SPEC.md §3, matching algorithm step 3).
 *
 * Returns `null` when the conversion is not resolvable.
 */
export function convert(
  value: number,
  from: Unit,
  to: Unit,
  densityGPerMl?: number,
): number | null {
  const inBase = value * from.toBase;

  if (from.dimension === to.dimension) {
    return finiteOrNull(inBase / to.toBase);
  }

  if (densityGPerMl === undefined || densityGPerMl <= 0) {
    return null;
  }

  // Cross-dimension: route through the density bridge (grams <-> millilitres).
  if (from.dimension === "mass" && to.dimension === "volume") {
    return finiteOrNull(inBase / densityGPerMl / to.toBase);
  }
  if (from.dimension === "volume" && to.dimension === "mass") {
    return finiteOrNull((inBase * densityGPerMl) / to.toBase);
  }

  // count <-> mass/volume is never resolvable, density or not.
  return null;
}

/**
 * A conversion that overflowed answers "can't verify", not a number.
 *
 * The data-entry layer bounds density to a physical range, but the CHECK
 * constraint behind it only says `> 0 AND < Infinity` — a density of `1e-300`
 * stores cleanly and then divides a real pantry quantity into `Infinity` here.
 * `Infinity >= required` is true for every recipe, so the result would be a
 * confident "have enough" off almost nothing. This is CLAUDE.md's float gotcha
 * reached through the divisor rather than through the quantity, and it is the
 * one arithmetic outcome the engine cannot pass on to the caller.
 */
function finiteOrNull(result: number): number | null {
  return Number.isFinite(result) ? result : null;
}
