import { listPantryWithIngredients } from "@/db/queries/pantry";
import { listRecipesWithLines } from "@/db/queries/recipes";
import { requireScope } from "@/lib/auth/session";
import { toPantry, toRecipe } from "@/lib/matching/from-storage";
import { matchRecipe } from "@/lib/matching/match";

import { RecipeListScreen } from "./recipe-list-screen";

/**
 * "What can I cook right now?" — the question the whole app exists to answer
 * (SPEC.md §1), against this household's real pantry and recipes.
 *
 * Both queries take their scope from `requireScope()`, which derives it from
 * the session row. No id in this route comes from the URL.
 */
export default async function RecipesPage() {
  const scope = await requireScope();

  const [recipes, pantryRows] = await Promise.all([
    listRecipesWithLines(scope),
    listPantryWithIngredients(scope),
  ]);

  const pantry = toPantry(pantryRows);
  // In the name order `listRecipesWithLines` reads them. The screen groups
  // them by bucket from these same results — no second query (SPEC.md §2.6).
  const entries = recipes.map((row) => ({
    id: row.id,
    name: row.name,
    baseServings: row.baseServings,
    result: matchRecipe(toRecipe(row, row.lines), pantry),
  }));

  return <RecipeListScreen entries={entries} pantryIsEmpty={pantryRows.length === 0} />;
}
