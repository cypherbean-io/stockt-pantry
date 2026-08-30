import "server-only";

import { findIngredientById, findOrCreateIngredient } from "@/db/queries/ingredients";
import { deletePantryItem, setPantryEntry, setPantryQuantity } from "@/db/queries/pantry";
import type { HouseholdScope } from "@/db/scope";
import type { FieldErrors } from "@/lib/forms";

import {
  parsePantryAmount,
  parsePantryEntry,
  parsePantryItemId,
  type PantryEntryInput,
} from "./entry";

/**
 * The pantry inventory flows (SPEC.md §2: a per-household list of
 * (ingredient, quantity, unit), added, corrected and removed by a member).
 *
 * Nothing here touches `next/headers`, for the same reason `auth/service.ts`
 * does not: the flows take a `HouseholdScope` and raw form values and hand back
 * a result, which is what makes them testable against a real database with no
 * request context — `src/db/pantry-flow.db.test.ts`.
 *
 * The scope is the only source of the household id. There is no parameter here
 * that names one, so no submission can redirect a write at another tenant
 * (SPEC.md §4).
 */

export type PantryError = "invalid-input" | "unknown-ingredient";

export type PantryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PantryError; readonly fieldErrors?: FieldErrors };

/**
 * What a caller is told about a saved row.
 *
 * Narrower than the database row on purpose: these results are returned from
 * server actions, and an action's return value is serialised to the client.
 */
export type StockedItem = {
  readonly id: string;
  readonly ingredientId: string;
  readonly quantity: number;
  readonly unitId: string;
};

function stocked(row: {
  readonly id: string;
  readonly ingredientId: string;
  readonly quantity: number;
  readonly unitId: string;
}): StockedItem {
  return {
    id: row.id,
    ingredientId: row.ingredientId,
    quantity: row.quantity,
    unitId: row.unitId,
  };
}

/**
 * Put an amount of something on the household's shelf.
 *
 * The ingredient is either one already in the household's catalog or a new
 * entry created from the name given — a fresh household has an empty catalog,
 * so without the second path the pantry could never be filled (SPEC.md §6,
 * step 3).
 *
 * Input is parsed in full before anything is written, so a rejected quantity
 * cannot leave a newly created catalog entry behind.
 */
export async function stockPantryItem(
  scope: HouseholdScope,
  input: PantryEntryInput,
): Promise<PantryResult<StockedItem>> {
  const parsed = parsePantryEntry(input);
  if (!parsed.ok) {
    return { ok: false, error: "invalid-input", fieldErrors: parsed.errors };
  }

  const { ingredient, quantity, unitId } = parsed.value;

  /**
   * The scoped lookup, not the composite foreign key, is what answers for an
   * id belonging to another household. The key would refuse the write too, but
   * only by raising a driver error whose message carries the bound values, and
   * that error must never be logged or rethrown (CLAUDE.md).
   */
  const entry =
    ingredient.kind === "existing"
      ? await findIngredientById(scope, ingredient.id)
      : await findOrCreateIngredient(scope, {
          name: ingredient.name,
          ...(ingredient.densityGPerMl === undefined
            ? {}
            : { densityGPerMl: ingredient.densityGPerMl }),
        });

  if (entry === undefined) {
    // Another household's id and one that never existed get the same answer,
    // so the response cannot be used to probe for which ids are real.
    return {
      ok: false,
      error: "unknown-ingredient",
      fieldErrors: { ingredientId: "That ingredient is not in this household's catalog." },
    };
  }

  // At most one pantry row per ingredient (schema.ts), so this replaces the
  // amount on the shelf rather than adding a second row for the same thing.
  const saved = await setPantryEntry(scope, {
    ingredientId: entry.id,
    quantity,
    unitId,
  });

  return { ok: true, value: stocked(saved) };
}

export type PantryAmountInput = {
  readonly id: unknown;
  readonly quantity: unknown;
  readonly unitId: unknown;
};

/**
 * Correct the amount and unit on an existing row.
 *
 * A value of `undefined` means nothing matched — the row belongs to another
 * household, or it has since been removed. That is deliberately not an error:
 * the two have to be indistinguishable, and the caller's answer to both is the
 * same, which is to re-render the list the household actually has.
 */
export async function restockPantryItem(
  scope: HouseholdScope,
  input: PantryAmountInput,
): Promise<PantryResult<StockedItem | undefined>> {
  const id = parsePantryItemId(input.id);
  const amount = parsePantryAmount(input);

  if (!id.ok || !amount.ok) {
    return {
      ok: false,
      error: "invalid-input",
      fieldErrors: { ...(id.ok ? {} : id.errors), ...(amount.ok ? {} : amount.errors) },
    };
  }

  const updated = await setPantryQuantity(scope, id.value, amount.value.quantity, amount.value.unitId);
  return { ok: true, value: updated === undefined ? undefined : stocked(updated) };
}

/**
 * Take a row off the shelf. `false` means nothing matched, on the same terms as
 * `restockPantryItem` above.
 *
 * The catalog entry stays: the ingredient still exists, the household just has
 * none of it, and recipe lines referencing it must keep resolving.
 */
export async function removePantryItem(
  scope: HouseholdScope,
  input: { readonly id: unknown },
): Promise<PantryResult<boolean>> {
  const id = parsePantryItemId(input.id);
  if (!id.ok) {
    return { ok: false, error: "invalid-input", fieldErrors: id.errors };
  }

  return { ok: true, value: await deletePantryItem(scope, id.value) };
}
