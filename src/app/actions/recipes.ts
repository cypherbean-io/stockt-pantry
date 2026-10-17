"use server";

import { redirect } from "next/navigation";

import { requireScope } from "@/lib/auth/session";
import { parseRecipeForm, type RecipeFieldErrors } from "@/lib/recipes/form";
import { removeRecipe, saveRecipeDraft, updateRecipeDraft } from "@/lib/recipes/service";

/**
 * Server actions for recipe management.
 *
 * Next.js treats these as public endpoints — reachable by anyone who can POST,
 * not only by the page that renders the form — so each one calls
 * `requireScope()` for itself and validates its own input. Nothing here trusts
 * a household id, an ingredient id, or a row count from the request.
 *
 * The flows themselves live in `src/lib/recipes/service.ts`, which takes the
 * scope rather than reading the session, so they are testable against a real
 * database without a request context.
 */

export type RecipeFormState =
  | { readonly message?: string; readonly fieldErrors?: RecipeFieldErrors }
  | undefined;

export async function createRecipeAction(
  _state: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const scope = await requireScope();

  const parsed = parseRecipeForm(formData);
  if (!parsed.ok) {
    return { message: parsed.message, fieldErrors: parsed.fieldErrors };
  }

  const saved = await saveRecipeDraft(scope, parsed.value);
  if (!saved.ok) {
    return { message: saved.message };
  }

  // `redirect` throws, so it must stay outside anything that catches.
  redirect(`/recipes/${saved.id}`);
}

/**
 * Save an edit over one of the caller's own recipes.
 *
 * The recipe id is a hidden form field, so it is request input like any other,
 * as it is for delete: it only ever reaches a scoped lookup and a scoped
 * update, which refuse another household's recipe exactly as they refuse one
 * that does not exist. The submission is parsed by the same `parseRecipeForm`
 * as a new recipe, because it is the same form.
 */
export async function updateRecipeAction(
  _state: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const scope = await requireScope();

  const parsed = parseRecipeForm(formData);
  if (!parsed.ok) {
    return { message: parsed.message, fieldErrors: parsed.fieldErrors };
  }

  const saved = await updateRecipeDraft(scope, formData.get("recipeId"), parsed.value);
  if (!saved.ok) {
    return { message: saved.message };
  }

  // The recipe page reads the session cookie, so it is dynamic and rendered
  // fresh: the redirect alone is enough to show the saved version.
  redirect(`/recipes/${saved.id}`);
}

/**
 * Delete one of the caller's own recipes.
 *
 * The id is a form field, so it is a request input like any other: it is only
 * ever passed to a scoped query, which answers "no such recipe" for another
 * household's id and for a malformed one alike.
 */
export async function deleteRecipeAction(formData: FormData): Promise<void> {
  const scope = await requireScope();

  await removeRecipe(scope, formData.get("recipeId"));

  // Both this page and the list read the session cookie, so both are dynamic
  // and neither is served from the client router cache — the redirect alone is
  // enough to show the list without the deleted recipe.
  redirect("/recipes");
}
