import type { Unit } from "./units";

/**
 * Inputs to the matching engine. These are plain shapes, deliberately not tied
 * to any Drizzle row type — the engine stays DB-free (CLAUDE.md, SPEC.md §5).
 */

export type Ingredient = {
  readonly id: string;
  readonly name: string;
  /** Absent means mass<->volume conversion is unresolvable for this item. */
  readonly densityGPerMl?: number;
};

export type Quantity = {
  readonly value: number;
  readonly unit: Unit;
};

export type PantryItem = {
  readonly ingredient: Ingredient;
  readonly quantity: Quantity;
};

export type RecipeIngredient = {
  readonly ingredient: Ingredient;
  readonly quantity: Quantity;
};

export type Recipe = {
  readonly name: string;
  readonly baseServings: number;
  readonly ingredients: readonly RecipeIngredient[];
};

/**
 * Per-line outcome. "unresolved" is a first-class state, distinct from
 * "missing" and "short": it means the data can't answer the question, not that
 * the pantry is lacking (SPEC.md §3 step 3).
 */
export type LineStatus = "have" | "short" | "missing" | "unresolved";

export type MatchedLine = {
  readonly ingredient: Ingredient;
  /** Amount the recipe needs at the requested serving count. */
  readonly required: Quantity;
  /** Pantry amount converted into the recipe line's unit; null if unresolved. */
  readonly available: number | null;
  readonly status: LineStatus;
  /** How much more is needed, in the recipe line's unit. 0 unless short/missing. */
  readonly shortfall: number;
};

export type MatchResult = {
  readonly recipeName: string;
  readonly servings: number;
  readonly makeable: boolean;
  readonly lines: readonly MatchedLine[];
};
