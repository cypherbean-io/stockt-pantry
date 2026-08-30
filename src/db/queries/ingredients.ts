import { asc, eq, ilike } from "drizzle-orm";

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
 * is pantry/recipe content — which SPEC.md §4 keeps out of the logs.
 */

const LABEL = "Ingredient query";

export type NewIngredient = {
  readonly name: string;
  readonly densityGPerMl?: number;
};

/**
 * Guarded even though the only thing it binds is a household id, which SPEC.md
 * §4 does allow in a log. Nothing on the import path catches this, so an
 * unguarded driver error would escape the action into Next's default handler,
 * which prints `Failed query: select ... params: ...` — and CLAUDE.md's rule
 * against that is categorical rather than a judgement about blast radius.
 */
export async function listIngredients(scope: HouseholdScope): Promise<IngredientRow[]> {
  return guarded(LABEL, () =>
    getDb()
      .select()
      .from(ingredient)
      .where(ownedBy(scope, ingredient))
      .orderBy(asc(ingredient.name)),
  );
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
 * Exact-name lookup, matching `ingredient_household_name_unique`.
 *
 * Distinct from `searchIngredients` below: this answers "does this household
 * already have this entry", which is a question about the constraint, so it
 * compares the way the constraint does — case-sensitively, no wildcards.
 */
export async function findIngredientByName(
  scope: HouseholdScope,
  name: string,
): Promise<IngredientRow | undefined> {
  const rows = await guarded(LABEL, () =>
    getDb()
      .select()
      .from(ingredient)
      .where(ownedBy(scope, ingredient, eq(ingredient.name, name)))
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
 * The entry for this name, creating it if the household does not have one.
 *
 * Adding something to the pantry — or resolving a recipe line's ingredient —
 * is one user action, so this is one operation rather than a check the caller
 * does first: `insert ... on conflict do nothing` settles the race with a
 * concurrent add of the same name inside Postgres, where the unique constraint
 * already is. Without it the loser of that race gets SQLSTATE 23505, and a
 * driver error out of here would carry the bound values into a log
 * (CLAUDE.md) — `guarded` is what stops that.
 *
 * An existing entry is returned untouched, density included. v1 has no surface
 * for editing an existing ingredient's density (SPEC.md §2, Out), and quietly
 * overwriting it here would be one.
 */
export async function findOrCreateIngredient(
  scope: HouseholdScope,
  values: NewIngredient,
): Promise<IngredientRow> {
  const densityGPerMl = assertOptionalDensity(values.densityGPerMl);

  const inserted = await guarded(LABEL, () =>
    getDb()
      .insert(ingredient)
      .values({ householdId: scope.householdId, name: values.name, densityGPerMl })
      .onConflictDoNothing({ target: [ingredient.householdId, ingredient.name] })
      .returning(),
  );

  const created = inserted[0];
  if (created !== undefined) return created;

  // `do nothing` waits for the conflicting transaction to commit before
  // returning empty, so by the time this runs the row it conflicted with is
  // visible to a fresh statement.
  const existing = await findIngredientByName(scope, values.name);
  if (existing === undefined) {
    throw new Error("Insert conflicted but no ingredient row was found");
  }
  return existing;
}
