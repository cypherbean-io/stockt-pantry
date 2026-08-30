import { asc, eq, ilike, sql } from "drizzle-orm";

import { getDb } from "../client";
import { guarded } from "../redact";
import { ingredient, type IngredientRow } from "../schema";
import { ownedBy, type HouseholdScope } from "../scope";
import { assertOptionalDensity } from "../validate";

/**
 * The per-household ingredient catalog (CLAUDE.md: there is no shared
 * cross-household catalog). Every function here takes the scope first and
 * builds its `where` clause with `ownedBy`.
 *
 * The queries that bind a caller-supplied *name* are wrapped in `guarded`.
 * Drizzle's error message quotes the bound parameters, and an ingredient name
 * is recipe content — which SPEC.md §4 keeps out of the logs.
 */

const LABEL = "Ingredient query";

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
 * Resolve a typed-in name to a catalog entry, case-insensitively.
 *
 * The lowering happens in SQL on purpose. JS `toLowerCase()` and Postgres
 * `lower()` disagree on a handful of codepoints, and the unique index this is
 * effectively probing is a Postgres one — normalising in JS instead would let
 * "the name is free" and "the insert succeeds" answer differently.
 *
 * The name is compared, never trusted: the household still comes from the
 * scope, so this cannot reach another tenant's identically-named entry.
 */
export async function findIngredientByName(
  scope: HouseholdScope,
  name: string,
): Promise<IngredientRow | undefined> {
  const rows = await guarded(LABEL, () =>
    getDb()
      .select()
      .from(ingredient)
      .where(
        ownedBy(
          scope,
          ingredient,
          sql`lower(${ingredient.name}) = lower(${name.trim()}::text)`,
        ),
      )
      .orderBy(asc(ingredient.name))
      .limit(1),
  );
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
  return guarded(LABEL, () =>
    getDb()
      .select()
      .from(ingredient)
      .where(ownedBy(scope, ingredient, ilike(ingredient.name, pattern)))
      .orderBy(asc(ingredient.name)),
  );
}

/**
 * The household id comes from the scope, never from the caller's payload —
 * that is what stops a crafted form body from writing into another tenant.
 */
export async function createIngredient(
  scope: HouseholdScope,
  values: NewIngredient,
): Promise<IngredientRow> {
  // Outside the guard: this throws a message worth showing, and redacting it
  // would replace it with a SQLSTATE that never happened.
  const densityGPerMl = assertOptionalDensity(values.densityGPerMl);

  const rows = await guarded(LABEL, () =>
    getDb()
      .insert(ingredient)
      .values({ householdId: scope.householdId, name: values.name, densityGPerMl })
      .returning(),
  );

  const created = rows[0];
  if (created === undefined) {
    throw new Error("Insert returned no ingredient row");
  }
  return created;
}

/**
 * The catalog entry for a name, creating one if the household has none.
 *
 * This is what "create new ingredient: <name>" resolves to on the recipe form,
 * and what the import review screen will need for the same reason (SPEC.md §3
 * step 4). An existing entry is returned as it stands — `densityGPerMl` is only
 * consulted when a row is actually created, because editing the density of an
 * existing ingredient is out of scope for v1 (SPEC.md §2).
 */
export async function findOrCreateIngredient(
  scope: HouseholdScope,
  values: NewIngredient,
): Promise<IngredientRow> {
  const name = values.name.trim();

  const existing = await findIngredientByName(scope, name);
  if (existing !== undefined) {
    return existing;
  }

  const densityGPerMl = assertOptionalDensity(values.densityGPerMl);

  const rows = await guarded(LABEL, () =>
    getDb()
      .insert(ingredient)
      .values({ householdId: scope.householdId, name, densityGPerMl })
      // Two members adding the same ingredient at once: the loser takes the
      // row the winner wrote rather than failing the whole save.
      .onConflictDoNothing({ target: [ingredient.householdId, ingredient.name] })
      .returning(),
  );

  const created = rows[0];
  if (created !== undefined) {
    return created;
  }

  const raced = await findIngredientByName(scope, name);
  if (raced === undefined) {
    throw new Error("Ingredient insert conflicted but no matching row was found");
  }
  return raced;
}
