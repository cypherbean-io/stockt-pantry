import { LinkButton } from "@/app/_components/ui/button";
import { PageHeader } from "@/app/_components/ui/page-header";
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
    <>
      <PageHeader
        title="Add a recipe"
        action={
          <LinkButton href="/recipes/import" variant="secondary" size="sm">
            Import from a URL
          </LinkButton>
        }
      />

      <RecipeForm catalog={catalog.map((row) => row.name)} />
    </>
  );
}
