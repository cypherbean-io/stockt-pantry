import type { Ingredient, PantryItem, Quantity, Recipe, RecipeIngredient } from "./types";
import { unitById } from "./units";

/**
 * Stored rows in, engine shapes out.
 *
 * The engine has no DB dependency and keeps none here: the input types below
 * are structural, describing the columns this needs rather than importing
 * Drizzle's row types. A `PantryItemRow` satisfies `StoredQuantity` by having
 * the right fields, and the matching engine stays testable with nothing
 * installed (CLAUDE.md, SPEC.md §5).
 *
 * Two column-shaped mismatches live here and nowhere else:
 *
 * 1. `unit_id` is text; the engine needs the conversion factor behind it.
 * 2. `density_g_per_ml` is nullable; the engine asks `=== undefined`. A null
 *    arriving intact would slip past that guard and be multiplied, turning
 *    "can't verify" into a confident zero.
 */

export type StoredIngredient = {
  readonly id: string;
  readonly name: string;
  readonly densityGPerMl: number | null;
};

export type StoredQuantity = {
  readonly quantity: number;
  readonly unitId: string;
};

export type StoredPantryItem = {
  readonly item: StoredQuantity;
  readonly ingredient: StoredIngredient;
};

export type StoredRecipeLine = {
  readonly line: StoredQuantity;
  readonly ingredient: StoredIngredient;
};

export type StoredRecipe = {
  readonly name: string;
  readonly baseServings: number;
};

export function toIngredient(row: StoredIngredient): Ingredient {
  return {
    id: row.id,
    name: row.name,
    densityGPerMl: row.densityGPerMl ?? undefined,
  };
}

/**
 * Throws rather than skipping the line. `unit_id` has a foreign key to the
 * seeded `unit` table and `units-seed.db.test.ts` holds that table to `UNITS`,
 * so an id with no factor means those have diverged — dropping the line would
 * quietly report a recipe makeable with one of its ingredients ignored.
 */
export function toQuantity(row: StoredQuantity): Quantity {
  const unit = unitById(row.unitId);
  if (unit === undefined) {
    throw new Error(`Stored unit id "${row.unitId}" has no conversion factor`);
  }
  return { value: row.quantity, unit };
}

export function toPantry(rows: readonly StoredPantryItem[]): PantryItem[] {
  return rows.map((row) => ({
    ingredient: toIngredient(row.ingredient),
    quantity: toQuantity(row.item),
  }));
}

export function toRecipeIngredient(row: StoredRecipeLine): RecipeIngredient {
  return {
    ingredient: toIngredient(row.ingredient),
    quantity: toQuantity(row.line),
  };
}

export function toRecipe(
  recipe: StoredRecipe,
  lines: readonly StoredRecipeLine[],
): Recipe {
  return {
    name: recipe.name,
    baseServings: recipe.baseServings,
    ingredients: lines.map(toRecipeIngredient),
  };
}
