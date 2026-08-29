import { asc, eq, ilike } from "drizzle-orm";

import { getDb } from "../client";
import { ingredient, type IngredientRow } from "../schema";
import { ownedBy, type HouseholdScope } from "../scope";
import { assertOptionalDensity } from "../validate";

/**
 * The per-household ingredient catalog (CLAUDE.md: there is no shared
 * cross-household catalog). Every function here takes the scope first and
 * builds its `where` clause with `ownedBy`.
 */

export type NewIngredient = {
  readonly name: string;
  readonly densityGPerMl?: number;
};

export async function listIngredients(scope: HouseholdScope): Promise<IngredientRow[]> {
  return getDb()
    .select()
    .from(ingredient)
    .where(ownedBy(scope, ingredient))
    .orderBy(asc(ingredient.name));
}

export async function findIngredientById(
  scope: HouseholdScope,
  id: string,
): Promise<IngredientRow | undefined> {
  const rows = await getDb()
    .select()
    .from(ingredient)
    .where(ownedBy(scope, ingredient, eq(ingredient.id, id)))
    .limit(1);
  return rows[0];
}

/**
 * Name search, used by the import review-and-confirm screen to suggest a
 * catalog entry for a parsed line (SPEC.md §3). Scoped like everything else:
 * the screen must never offer another household's ingredients.
 */
export async function searchIngredients(
  scope: HouseholdScope,
  term: string,
): Promise<IngredientRow[]> {
  // `ilike` parameterises the pattern, but `%` and `_` inside the user's term
  // would still widen the match, so they are escaped before wrapping.
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  return getDb()
    .select()
    .from(ingredient)
    .where(ownedBy(scope, ingredient, ilike(ingredient.name, pattern)))
    .orderBy(asc(ingredient.name));
}

/**
 * The household id comes from the scope, never from the caller's payload —
 * that is what stops a crafted form body from writing into another tenant.
 */
export async function createIngredient(
  scope: HouseholdScope,
  values: NewIngredient,
): Promise<IngredientRow> {
  const rows = await getDb()
    .insert(ingredient)
    .values({
      householdId: scope.householdId,
      name: values.name,
      densityGPerMl: assertOptionalDensity(values.densityGPerMl),
    })
    .returning();

  const created = rows[0];
  if (created === undefined) {
    throw new Error("Insert returned no ingredient row");
  }
  return created;
}
