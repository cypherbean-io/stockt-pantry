import Link from "next/link";
import { notFound } from "next/navigation";

import { MatchTable, ShoppingList } from "@/app/_components/match";
import { deleteRecipeAction } from "@/app/actions/recipes";
import { listPantryWithIngredients } from "@/db/queries/pantry";
import { findRecipeWithLines } from "@/db/queries/recipes";
import { requireScope } from "@/lib/auth/session";
import { toPantry, toRecipe } from "@/lib/matching/from-storage";
import { matchRecipe, shoppingList } from "@/lib/matching/match";
import { MAX_SERVINGS, parseServings } from "@/lib/recipes/form";

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
  const toBuy = shoppingList(result);

  return (
    <main>
      <h1>{stored.name}</h1>
      <p>
        <Link href="/recipes">All recipes</Link>
      </p>
      {stored.sourceUrl !== null && (
        <p>
          {/* Imported recipes carry the page they came from. It is a URL a user
              pasted, so it is rendered as plain text rather than as a link. */}
          <small>Imported from {stored.sourceUrl}</small>
        </p>
      )}

      <h2>Can I make this?</h2>
      <form>
        <label htmlFor="servings">Servings</label>{" "}
        <input
          id="servings"
          name="servings"
          type="number"
          min={1}
          max={MAX_SERVINGS}
          step={1}
          defaultValue={servings}
        />{" "}
        <button type="submit">Rescale</button>{" "}
        <small>Recipe is written for {stored.baseServings}.</small>
      </form>

      <p>
        <strong>{result.makeable ? "Makeable" : "Not makeable"}</strong>
        {!result.makeable &&
          result.lines.some((line) => line.status === "unresolved") &&
          " — at least one ingredient cannot be checked without a density."}
      </p>

      <MatchTable result={result} />

      <h2>Shopping list</h2>
      <p>
        <small>
          What is missing or short at {servings} servings. Buying it does not update the pantry —
          re-enter what you bought yourself.
        </small>
      </p>
      <ShoppingList lines={toBuy} />

      <h2>Steps</h2>
      {stored.steps.length === 0 ? (
        <p>No steps recorded.</p>
      ) : (
        <ol>
          {stored.steps.map((step, index) => (
            // Steps are free text and may repeat, so the position is the only
            // stable identity available. They are never reordered in place.
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}

      <h2>Delete</h2>
      <details>
        <summary>Delete this recipe</summary>
        <form action={deleteRecipeAction}>
          <input type="hidden" name="recipeId" value={stored.id} />
          <p>
            <small>This cannot be undone. The ingredients stay in the catalog.</small>
          </p>
          <button type="submit">Yes, delete {stored.name}</button>
        </form>
      </details>
    </main>
  );
}
