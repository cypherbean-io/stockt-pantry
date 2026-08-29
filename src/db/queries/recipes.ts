import { asc, eq } from "drizzle-orm";

import { getDb } from "../client";
import {
  recipe,
  recipeIngredient,
  type RecipeIngredientRow,
  type RecipeRow,
} from "../schema";
import { ownedBy, type HouseholdScope } from "../scope";
import { assertPositiveQuantity, assertPositiveServings } from "../validate";
import type { UnitKey } from "@/lib/matching/units";

/**
 * Recipe reads and writes, all scoped to one household (SPEC.md §4).
 *
 * `recipe_ingredient` has no route of its own — it is reached through a recipe
 * id — so the leak to guard against is loading another household's lines by
 * guessing that id. The lines carry `household_id` themselves, so the scoping
 * predicate applies to both tables rather than trusting the join.
 */

export type NewRecipeLine = {
  readonly ingredientId: string;
  readonly quantity: number;
  readonly unitId: UnitKey;
};

export type NewRecipe = {
  readonly name: string;
  readonly baseServings: number;
  readonly steps: readonly string[];
  readonly sourceUrl?: string;
  readonly ingredients: readonly NewRecipeLine[];
};

export type RecipeWithIngredients = RecipeRow & {
  readonly ingredients: readonly RecipeIngredientRow[];
};

export async function listRecipes(scope: HouseholdScope): Promise<RecipeRow[]> {
  return getDb()
    .select()
    .from(recipe)
    .where(ownedBy(scope, recipe))
    .orderBy(asc(recipe.name));
}

export async function findRecipeById(
  scope: HouseholdScope,
  id: string,
): Promise<RecipeRow | undefined> {
  const rows = await getDb()
    .select()
    .from(recipe)
    .where(ownedBy(scope, recipe, eq(recipe.id, id)))
    .limit(1);
  return rows[0];
}

export async function findRecipeWithIngredients(
  scope: HouseholdScope,
  id: string,
): Promise<RecipeWithIngredients | undefined> {
  const found = await findRecipeById(scope, id);
  if (found === undefined) {
    return undefined;
  }

  const lines = await getDb()
    .select()
    .from(recipeIngredient)
    .where(ownedBy(scope, recipeIngredient, eq(recipeIngredient.recipeId, id)))
    .orderBy(asc(recipeIngredient.id));

  return { ...found, ingredients: lines };
}

/**
 * Write the recipe and its lines together. This is the save at the end of the
 * import review-and-confirm step (SPEC.md §3) as well as manual entry — either
 * way nothing lands until the whole thing does, so a failed line cannot leave a
 * half-imported recipe behind.
 */
export async function createRecipe(
  scope: HouseholdScope,
  values: NewRecipe,
): Promise<RecipeWithIngredients> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .insert(recipe)
      .values({
        householdId: scope.householdId,
        name: values.name,
        baseServings: assertPositiveServings(values.baseServings),
        steps: [...values.steps],
        sourceUrl: values.sourceUrl,
      })
      .returning();

    const created = rows[0];
    if (created === undefined) {
      throw new Error("Insert returned no recipe row");
    }

    if (values.ingredients.length === 0) {
      return { ...created, ingredients: [] };
    }

    const lines = await tx
      .insert(recipeIngredient)
      .values(
        values.ingredients.map((line) => ({
          householdId: scope.householdId,
          recipeId: created.id,
          ingredientId: line.ingredientId,
          quantity: assertPositiveQuantity(line.quantity, "Quantity"),
          unitId: line.unitId,
        })),
      )
      .returning();

    return { ...created, ingredients: lines };
  });
}

/** Returns whether a recipe was removed. False for another household's id. */
export async function deleteRecipe(scope: HouseholdScope, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(recipe)
    .where(ownedBy(scope, recipe, eq(recipe.id, id)))
    .returning({ id: recipe.id });
  return rows.length > 0;
}
