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

/**
 * What an edit can change. No `sourceUrl`: where a recipe came from is fixed
 * when it is saved, and an edit is not an import.
 */
export type RecipeChanges = Omit<NewRecipe, "sourceUrl">;

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

  // Guarded although it binds only two uuids: `updateRecipeDraft` logs what
  // escapes from here, and CLAUDE.md's rule against logging a driver error's
  // message is categorical rather than a judgement about what it binds.
  const rows = await guarded(LABEL, () =>
    getDb()
      .select()
      .from(recipe)
      .where(ownedBy(scope, recipe, eq(recipe.id, id)))
      .limit(1),
  );
  return rows[0];
}

/**
 * The join is scoped on both sides. The composite foreign key already makes a
 * line pointing at another household's catalog entry unstorable, but the
 * predicate does not lean on that holding.
 *
 * Guarded for the reason `findRecipeById` is: the recipe pages and the edit
 * page reach this, and a driver error escaping a page is printed by Next's
 * default handler.
 */
function linesWithIngredients(
  scope: HouseholdScope,
  extra?: SQL,
): Promise<RecipeLineWithIngredient[]> {
  return guarded(LABEL, () =>
    getDb()
      .select({ line: recipeIngredient, ingredient })
      .from(recipeIngredient)
      .innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
      .where(ownedBy(scope, recipeIngredient, ownedBy(scope, ingredient), extra))
      .orderBy(asc(ingredient.name)),
  );
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
 * Called before the guard, so these keep their own messages instead of being
 * redacted into a SQLSTATE that never happened.
 */
function validated(values: RecipeChanges): {
  readonly baseServings: number;
  readonly lines: readonly NewRecipeLine[];
} {
  return {
    baseServings: assertPositiveServings(values.baseServings),
    lines: values.ingredients.map((line) => ({
      ingredientId: line.ingredientId,
      quantity: assertPositiveQuantity(line.quantity, "Quantity"),
      unitId: line.unitId,
    })),
  };
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
  const { baseServings, lines } = validated(values);

  // Guarded because this binds recipe contents: Drizzle's error message quotes
  // its parameters, and SPEC.md §4 keeps recipe contents out of the logs.
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
 * Save an edit over one of the household's own recipes: its name, servings and
 * steps, and a replacement for every line.
 *
 * Returns the rows as written, or `undefined` when the id is not this
 * household's — another tenant's recipe, a deleted one, and a malformed id all
 * get the same answer, as they do in `deleteRecipe`.
 *
 * The lines are replaced rather than diffed. Nothing refers to a line's own id
 * — it has no route, and matching reads the set — so delete-and-insert is the
 * whole of it, and it sidesteps the (recipe, ingredient) unique constraint
 * that an in-place swap of two lines' ingredients would trip over. One
 * transaction, so a rejected line leaves the recipe exactly as it was rather
 * than renamed over an empty list.
 *
 * `source_url` is not in the `set`. An edit cannot add, change or clear where
 * the recipe came from.
 */
export async function updateRecipe(
  scope: HouseholdScope,
  id: string,
  changes: RecipeChanges,
): Promise<SavedRecipe | undefined> {
  if (!isRowId(id)) {
    return undefined;
  }

  const { baseServings, lines } = validated(changes);

  // Guarded for the reason `createRecipe` is: this binds the recipe's contents.
  return guarded(LABEL, () =>
    getDb().transaction(async (tx) => {
      const rows = await tx
        .update(recipe)
        .set({ name: changes.name, baseServings, steps: [...changes.steps] })
        .where(ownedBy(scope, recipe, eq(recipe.id, id)))
        .returning();

      const updated = rows[0];
      if (updated === undefined) {
        return undefined;
      }

      // Scoped on its own terms rather than leaning on the update above having
      // matched: the predicate is what keeps this to the household's own lines.
      await tx
        .delete(recipeIngredient)
        .where(ownedBy(scope, recipeIngredient, eq(recipeIngredient.recipeId, id)));

      if (lines.length === 0) {
        return { ...updated, ingredients: [] };
      }

      const saved = await tx
        .insert(recipeIngredient)
        .values(
          lines.map((line) => ({
            householdId: scope.householdId,
            recipeId: updated.id,
            ingredientId: line.ingredientId,
            quantity: line.quantity,
            unitId: line.unitId,
          })),
        )
        .returning();

      return { ...updated, ingredients: saved };
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
