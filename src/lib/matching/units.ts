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
    return inBase / to.toBase;
  }

  if (densityGPerMl === undefined || densityGPerMl <= 0) {
    return null;
  }

  // Cross-dimension: route through the density bridge (grams <-> millilitres).
  if (from.dimension === "mass" && to.dimension === "volume") {
    return inBase / densityGPerMl / to.toBase;
  }
  if (from.dimension === "volume" && to.dimension === "mass") {
    return (inBase * densityGPerMl) / to.toBase;
  }

  // count <-> mass/volume is never resolvable, density or not.
  return null;
}
