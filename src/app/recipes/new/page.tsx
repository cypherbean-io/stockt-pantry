import Link from "next/link";

import { listIngredients } from "@/db/queries/ingredients";
import { requireScope } from "@/lib/auth/session";

import { RecipeForm } from "../_components/recipe-form";

/**
 * Manual recipe entry: the same form as the import review screen
 * (`/recipes/import`), with nothing filled in.
 *
 * The catalog handed to the form is only this household's, and only the names:
 * it is a suggestion list, and the ids the recipe is saved with are resolved
 * server-side from the name, never taken from the client.
 */
export default async function NewRecipePage() {
  const scope = await requireScope();
  const catalog = await listIngredients(scope);

  return (
    <main>
      <h1>Add a recipe</h1>
      <p>
        <Link href="/recipes">All recipes</Link> ·{" "}
        <Link href="/recipes/import">Import one from a URL</Link>
      </p>

      <RecipeForm catalog={catalog.map((row) => row.name)} />
    </main>
  );
}
