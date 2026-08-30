"use server";

import { redirect } from "next/navigation";

import { findOrCreateIngredient } from "@/db/queries/ingredients";
import { createRecipe, deleteRecipe } from "@/db/queries/recipes";
import { requireScope } from "@/lib/auth/session";
import { parseRecipeForm, type RecipeFieldErrors } from "@/lib/recipes/form";

/**
 * Server actions for recipe management.
 *
 * Next.js treats these as public endpoints — reachable by anyone who can POST,
 * not only by the page that renders the form — so each one calls
 * `requireScope()` for itself and validates its own input. Nothing here trusts
 * a household id, an ingredient id, or a row count from the request.
 */

export type RecipeFormState =
  | { readonly message?: string; readonly fieldErrors?: RecipeFieldErrors }
  | undefined;

/**
 * Safe to log only because every query this file calls — `createRecipe`,
 * `findOrCreateIngredient`, `deleteRecipe` — routes its driver errors through
 * `src/db/redact.ts` first, so what arrives carries the SQLSTATE and constraint
 * name and nothing else. The unredacted message quotes the bound parameters,
 * which here are the whole recipe; SPEC.md §4 keeps that out of the logs. A new
 * query called from here has to be guarded the same way before it lands in this.
 */
function reportFailure(what: string, error: unknown): void {
  console.error(`${what} failed:`, error instanceof Error ? error.message : "unknown error");
}

export async function createRecipeAction(
  _state: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const scope = await requireScope();

  const parsed = parseRecipeForm(formData);
  if (!parsed.ok) {
    return { message: parsed.message, fieldErrors: parsed.fieldErrors };
  }

  let savedId: string;
  try {
    // Each typed-in name becomes a catalog entry in *this* household, existing
    // or new — the ids the recipe is written with are never client-supplied.
    // The density is only consulted when a row is actually created.
    const ingredients = await Promise.all(
      parsed.value.lines.map(async (line) => ({
        ingredientId: (
          await findOrCreateIngredient(scope, {
            name: line.name,
            densityGPerMl: line.densityGPerMl,
          })
        ).id,
        quantity: line.quantity,
        unitId: line.unitId,
      })),
    );

    const saved = await createRecipe(scope, {
      name: parsed.value.name,
      baseServings: parsed.value.baseServings,
      steps: parsed.value.steps,
      ingredients,
    });
    savedId = saved.id;
  } catch (error) {
    reportFailure("Saving a recipe", error);
    // Deliberately not "nothing was written". The recipe and its lines are
    // written in one transaction, so *that* is all-or-nothing — but the catalog
    // entries above are resolved first, each in its own, so a failure part-way
    // through can leave new ingredients behind. They are entries the user asked
    // for by name, and re-submitting reuses them.
    return { message: "Could not save that recipe. It was not added to your recipes." };
  }

  // `redirect` throws, so it must stay outside the try above.
  redirect(`/recipes/${savedId}`);
}

/**
 * Delete one of the caller's own recipes.
 *
 * The id is a form field, so it is a request input like any other: it is only
 * ever passed to a scoped query, which answers "no such recipe" for another
 * household's id and for a malformed one alike. The outcome is not reported
 * back for the same reason — a "no such recipe" response would tell an outsider
 * which ids exist.
 */
export async function deleteRecipeAction(formData: FormData): Promise<void> {
  const scope = await requireScope();

  const id = formData.get("recipeId");
  if (typeof id === "string") {
    try {
      await deleteRecipe(scope, id);
    } catch (error) {
      reportFailure("Deleting a recipe", error);
    }
  }

  // Both this page and the list read the session cookie, so both are dynamic
  // and neither is served from the client router cache — the redirect alone is
  // enough to show the list without the deleted recipe.
  redirect("/recipes");
}
