import { notFound } from "next/navigation";

import { LinkButton } from "@/app/_components/ui/button";
import { PageHeader } from "@/app/_components/ui/page-header";
import { listIngredients } from "@/db/queries/ingredients";
import { findRecipeWithLines } from "@/db/queries/recipes";
import { requireScope } from "@/lib/auth/session";
import { recipeFormValues } from "@/lib/recipes/form";

import { RecipeForm } from "../../_components/recipe-form";

/**
 * Editing a saved recipe: the same form as `/recipes/new`, filled in from the
 * stored recipe and saved back over it.
 *
 * The id is a URL segment, so it is only ever handed to a scoped query, and
 * another household's recipe lands on the same 404 as one that does not exist
 * — as on `/recipes/[id]`. That matters more here than there: this page puts
 * every field of the recipe into the HTML.
 *
 * The catalog handed to the form is only this household's names, as on
 * `/recipes/new`: the ids a recipe is saved with are resolved server-side.
 */
export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const scope = await requireScope();
  const { id } = await params;

  const stored = await findRecipeWithLines(scope, id);
  if (stored === undefined) {
    notFound();
  }

  const catalog = await listIngredients(scope);

  return (
    <>
      <PageHeader
        title={`Edit ${stored.name}`}
        action={
          <LinkButton href={`/recipes/${stored.id}`} variant="secondary" size="sm">
            Cancel
          </LinkButton>
        }
      />

      <RecipeForm
        catalog={catalog.map((row) => row.name)}
        editing={{ recipeId: stored.id, values: recipeFormValues(stored) }}
      />
    </>
  );
}
