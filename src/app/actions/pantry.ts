"use server";

import { refresh } from "next/cache";

import { requireScope } from "@/lib/auth/session";
import type { FieldErrors } from "@/lib/forms";
import {
  removePantryItem,
  restockPantryItem,
  stockPantryItem,
  type PantryError,
  type PantryResult,
} from "@/lib/pantry/service";

/**
 * Server actions for the pantry forms.
 *
 * Next.js treats these as public endpoints — reachable by anyone who can POST,
 * not only by the page that rendered the form — so each one calls
 * `requireScope()` for itself rather than trusting that a form was rendered
 * behind the session check. The household id comes from that scope and from
 * nowhere in the request body (SPEC.md §4).
 *
 * `refresh()` rather than `revalidatePath()`: these pages read the session
 * cookie, so nothing about them is cached. What has to happen after a write is
 * that the client re-renders the route against the new rows, which is exactly
 * what `refresh` asks for.
 */

export type PantryFormState =
  | { readonly message?: string; readonly fieldErrors?: FieldErrors }
  | undefined;

/**
 * The form-level message, which every failure here shares. The specific
 * wording sits on the field it belongs to, so nothing is said twice — and for
 * `unknown-ingredient` that wording deliberately does not distinguish an id
 * belonging to another household from one belonging to nobody, because the
 * layers below cannot tell those apart either.
 */
const MESSAGES: Record<PantryError, string> = {
  "invalid-input": "Check the fields below.",
  "unknown-ingredient": "Check the fields below.",
};

function failure(result: Extract<PantryResult<unknown>, { ok: false }>): PantryFormState {
  return { message: MESSAGES[result.error], fieldErrors: result.fieldErrors };
}

export async function addPantryItemAction(
  _state: PantryFormState,
  formData: FormData,
): Promise<PantryFormState> {
  const scope = await requireScope();

  const result = await stockPantryItem(scope, {
    ingredientId: formData.get("ingredientId"),
    ingredientName: formData.get("ingredientName"),
    densityGPerMl: formData.get("densityGPerMl"),
    quantity: formData.get("quantity"),
    unitId: formData.get("unitId"),
  });

  if (!result.ok) return failure(result);

  refresh();
  return undefined;
}

export async function updatePantryItemAction(
  _state: PantryFormState,
  formData: FormData,
): Promise<PantryFormState> {
  const scope = await requireScope();

  const result = await restockPantryItem(scope, {
    id: formData.get("id"),
    quantity: formData.get("quantity"),
    unitId: formData.get("unitId"),
  });

  if (!result.ok) return failure(result);

  // A `value` of undefined means no row matched. That is not reported as an
  // error: the row was another household's or has since been removed, and the
  // honest answer to both is the list as it actually stands.
  refresh();
  return undefined;
}

export async function removePantryItemAction(
  _state: PantryFormState,
  formData: FormData,
): Promise<PantryFormState> {
  const scope = await requireScope();

  const result = await removePantryItem(scope, { id: formData.get("id") });

  if (!result.ok) return failure(result);

  refresh();
  return undefined;
}
