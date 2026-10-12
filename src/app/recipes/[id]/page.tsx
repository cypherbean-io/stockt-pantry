import { notFound } from "next/navigation";

import { listPantryWithIngredients } from "@/db/queries/pantry";
import { findRecipeWithLines } from "@/db/queries/recipes";
import { requireScope } from "@/lib/auth/session";
import { toPantry, toRecipe } from "@/lib/matching/from-storage";
import { matchRecipe } from "@/lib/matching/match";
import { parseServings } from "@/lib/recipes/form";

import { RecipeScreen } from "./recipe-screen";

/**
 * One recipe: can I make it, at how many servings, and what would I have to buy.
 *
 * The id is a URL segment, so it is only ever handed to a scoped query.
 * `findRecipeWithLines` answers `undefined` for another household's recipe and
 * for one that does not exist alike, and both land on the same 404 — guessing
 * an id must not be a way to learn that it is real.
 */
export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await requireScope();
  const { id } = await params;

  const stored = await findRecipeWithLines(scope, id);
  if (stored === undefined) {
    notFound();
  }

  const requested = (await searchParams)["servings"];
  const servings = parseServings(
    typeof requested === "string" ? requested : undefined,
    stored.baseServings,
  );

  const result = matchRecipe(
    toRecipe(stored, stored.lines),
    toPantry(await listPantryWithIngredients(scope)),
    servings,
  );

  return (
    <RecipeScreen
      recipe={{
        id: stored.id,
        name: stored.name,
        baseServings: stored.baseServings,
        sourceUrl: stored.sourceUrl,
        steps: stored.steps,
      }}
      servings={servings}
      result={result}
    />
  );
}
