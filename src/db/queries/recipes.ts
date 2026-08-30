import { asc, eq, type SQL } from "drizzle-orm";

import { getDb } from "../client";
import { guarded } from "../redact";
import {
  ingredient,
  recipe,
  recipeIngredient,
  type IngredientRow,
  type RecipeIngredientRow,
  type RecipeRow,
} from "../schema";
import { isRowId, ownedBy, type HouseholdScope } from "../scope";
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

const LABEL = "Recipe query";

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

/** What `createRecipe` hands back: the rows it just wrote, nothing joined. */
export type SavedRecipe = RecipeRow & {
  readonly ingredients: readonly RecipeIngredientRow[];
};

/**
 * A line together with the catalog entry it points at. Matching needs the
 * ingredient's name and density, not just its id, so every read path that
 * feeds the engine returns this shape.
 */
export type RecipeLineWithIngredient = {
  readonly line: RecipeIngredientRow;
  readonly ingredient: IngredientRow;
};

export type RecipeWithLines = RecipeRow & {
  readonly lines: readonly RecipeLineWithIngredient[];
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
  // A recipe id arrives as a URL segment. Postgres rejects a malformed `uuid`
  // rather than matching nothing, so this is what keeps `/recipes/nonsense` a
  // 404 instead of a 500 with the statement and household id in the log.
  if (!isRowId(id)) {
    return undefined;
  }

  const rows = await getDb()
    .select()
    .from(recipe)
    .where(ownedBy(scope, recipe, eq(recipe.id, id)))
    .limit(1);
  return rows[0];
}

/**
 * The join is scoped on both sides. The composite foreign key already makes a
 * line pointing at another household's catalog entry unstorable, but the
 * predicate does not lean on that holding.
 */
function linesWithIngredients(
  scope: HouseholdScope,
  extra?: SQL,
): Promise<RecipeLineWithIngredient[]> {
  return getDb()
    .select({ line: recipeIngredient, ingredient })
    .from(recipeIngredient)
    .innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
    .where(ownedBy(scope, recipeIngredient, ownedBy(scope, ingredient), extra))
    .orderBy(asc(ingredient.name));
}

export async function findRecipeWithLines(
  scope: HouseholdScope,
  id: string,
): Promise<RecipeWithLines | undefined> {
  const found = await findRecipeById(scope, id);
  if (found === undefined) {
    return undefined;
  }

  return {
    ...found,
    lines: await linesWithIngredients(scope, eq(recipeIngredient.recipeId, id)),
  };
}

/**
 * Every recipe with its lines — what "what can I make" needs, since a recipe's
 * status is only knowable from all of its lines at once.
 *
 * Two scoped queries grouped in JavaScript rather than one aggregate: a recipe
 * with no lines yet still has to appear in the list, and an inner join would
 * drop it.
 */
export async function listRecipesWithLines(scope: HouseholdScope): Promise<RecipeWithLines[]> {
  const recipes = await listRecipes(scope);
  if (recipes.length === 0) {
    return [];
  }

  const byRecipe = new Map<string, RecipeLineWithIngredient[]>();
  for (const row of await linesWithIngredients(scope)) {
    const bucket = byRecipe.get(row.line.recipeId);
    if (bucket === undefined) {
      byRecipe.set(row.line.recipeId, [row]);
    } else {
      bucket.push(row);
    }
  }

  return recipes.map((row) => ({ ...row, lines: byRecipe.get(row.id) ?? [] }));
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
): Promise<SavedRecipe> {
  // Validated before the guard, so these keep their own messages instead of
  // being redacted into a SQLSTATE that never happened.
  const baseServings = assertPositiveServings(values.baseServings);
  const lines = values.ingredients.map((line) => ({
    ingredientId: line.ingredientId,
    quantity: assertPositiveQuantity(line.quantity, "Quantity"),
    unitId: line.unitId,
  }));

  // Guarded because this is the one query here that binds recipe contents:
  // Drizzle's error message quotes its parameters, and SPEC.md §4 keeps recipe
  // contents out of the logs.
  return guarded(LABEL, () =>
    getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(recipe)
        .values({
          householdId: scope.householdId,
          name: values.name,
          baseServings,
          steps: [...values.steps],
          sourceUrl: values.sourceUrl,
        })
        .returning();

      const created = rows[0];
      if (created === undefined) {
        throw new Error("Insert returned no recipe row");
      }

      if (lines.length === 0) {
        return { ...created, ingredients: [] };
      }

      const saved = await tx
        .insert(recipeIngredient)
        .values(
          lines.map((line) => ({
            householdId: scope.householdId,
            recipeId: created.id,
            ingredientId: line.ingredientId,
            quantity: line.quantity,
            unitId: line.unitId,
          })),
        )
        .returning();

      return { ...created, ingredients: saved };
    }),
  );
}

/**
 * Returns whether a recipe was removed. False for another household's id, and
 * false for an id that is not shaped like one at all — a caller acting on
 * something that is not theirs should not be able to tell the two apart.
 */
export async function deleteRecipe(scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isRowId(id)) {
    return false;
  }

  // Guarded like `createRecipe`, even though only two uuids bind here: this is
  // the one statement on the path whose failure the action logs, and an
  // unredacted `DrizzleQueryError` would put `Failed query: delete from ...`
  // into that log line.
  const rows = await guarded(LABEL, () =>
    getDb()
      .delete(recipe)
      .where(ownedBy(scope, recipe, eq(recipe.id, id)))
      .returning({ id: recipe.id }),
  );
  return rows.length > 0;
}
