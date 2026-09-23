import Link from "next/link";

import { summarise } from "@/app/_components/match";
import { LinkButton } from "@/app/_components/ui/button";
import { PageHeader } from "@/app/_components/ui/page-header";
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
    <>
      {/*
        The `·`-separated link line that used to sit here is gone (SPEC.md
        §3.3): Pantry and Household are navigation and live in the shell now.
        What is left is contextual — two things to do with recipes — so it goes
        in the page header's action slot rather than pretending to be a nav.
      */}
      <PageHeader
        title="What can I make?"
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/recipes/new" variant="secondary" size="sm">
              Add a recipe
            </LinkButton>
            <LinkButton href="/recipes/import" variant="secondary" size="sm">
              Import from a URL
            </LinkButton>
          </div>
        }
      />

      {pantryRows.length === 0 && (
        <p>
          <strong>The pantry is empty.</strong> Until it has something in it, every recipe here
          will read as missing every ingredient. <Link href="/pantry">Add what you have</Link>.
        </p>
      )}

      {recipes.length === 0 ? (
        <p>
          No recipes yet. <Link href="/recipes/new">Add the first one</Link>, or{" "}
          <Link href="/recipes/import">import one from a URL</Link>.
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
    </>
  );
}
