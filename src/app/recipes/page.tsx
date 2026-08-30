import Link from "next/link";

import { summarise } from "@/app/_components/match";
import { listPantryWithIngredients } from "@/db/queries/pantry";
import { listRecipesWithLines } from "@/db/queries/recipes";
import { requireScope } from "@/lib/auth/session";
import { toPantry, toRecipe } from "@/lib/matching/from-storage";
import { matchRecipe } from "@/lib/matching/match";

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
  const evaluated = recipes
    .map((row) => ({ row, result: matchRecipe(toRecipe(row, row.lines), pantry) }))
    // `listRecipesWithLines` already orders by name; Array.prototype.sort is
    // stable, so this only lifts the makeable ones without disturbing that.
    .sort((a, b) => Number(b.result.makeable) - Number(a.result.makeable));

  return (
    <main>
      <h1>What can I make?</h1>
      <p>
        <Link href="/recipes/new">Add a recipe</Link> · <Link href="/pantry">Your pantry</Link> ·{" "}
        <Link href="/household">Your household</Link>
      </p>

      {pantryRows.length === 0 && (
        <p>
          <strong>The pantry is empty.</strong> Until it has something in it, every recipe here
          will read as missing every ingredient. <Link href="/pantry">Add what you have</Link>.
        </p>
      )}

      {recipes.length === 0 ? (
        <p>
          No recipes yet. <Link href="/recipes/new">Add the first one</Link>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th align="left">Recipe</th>
              <th align="left">Serves</th>
              <th align="left">Status</th>
            </tr>
          </thead>
          <tbody>
            {evaluated.map(({ row, result }) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/recipes/${row.id}`}>{row.name}</Link>
                </td>
                <td>{row.baseServings}</td>
                <td>{summarise(result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
