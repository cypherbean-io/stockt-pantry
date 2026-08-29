import { sql } from "drizzle-orm";

import { getDb, type Database } from "../client";
import { household, ingredient, invite, pantryItem, recipe, recipeIngredient, user } from "../schema";

/**
 * Fixtures for the integration suite.
 *
 * The suite talks to a real Postgres (SPEC.md §5 — tenant isolation is only
 * meaningfully tested against the database that enforces it). The container is
 * started by `global-setup.ts`; this module is the per-test half.
 */

/** Defaults to the docker-compose.test.yml service. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/stockt_test";

/**
 * `getDb` reads DATABASE_URL, and the test process should never inherit a
 * developer's real one — point it at the throwaway database before the pool is
 * built rather than hoping the environment is clean.
 */
export function testDb(): Database {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  return getDb();
}

/**
 * Refuse to touch anything that is not the throwaway database.
 *
 * `getDb()` memoises the first connection string it is given, so setting
 * `process.env.DATABASE_URL` in `testDb()` only wins if nothing built the pool
 * first. That holds today, but the failure mode if it ever stops holding is
 * `resetDatabase()` truncating a developer's real database, silently. So the
 * check asks the *live connection* what database it is attached to rather than
 * trusting the environment variable that was supposed to have set it.
 */
async function assertThrowawayDatabase(): Promise<void> {
  const [row] = await testDb().execute<{ current_database: string }>(
    sql`select current_database()`,
  );
  const name = row?.current_database;

  if (name === undefined || !name.endsWith("_test")) {
    throw new Error(
      `Refusing to truncate database "${name ?? "unknown"}": the test suite only ` +
        "operates on a database whose name ends in _test. Check DATABASE_URL and " +
        "TEST_DATABASE_URL.",
    );
  }
}

/**
 * Everything tenant-owned hangs off `household` by a cascading foreign key, so
 * one truncate clears the fixtures. `unit` is reference data seeded by the
 * migrations and deliberately survives.
 */
export async function resetDatabase(): Promise<void> {
  await assertThrowawayDatabase();
  await testDb().execute(sql`truncate table ${household} restart identity cascade`);
}

export type SeededHousehold = {
  readonly householdId: string;
  readonly userId: string;
  readonly inviteId: string;
  readonly ingredientId: string;
  readonly pantryItemId: string;
  readonly recipeId: string;
};

/**
 * One household with one of everything, inserted unscoped on purpose: the
 * fixtures are the setup, and the point of the suite is that the *scoped* API
 * cannot reach across them.
 *
 * Both households get an ingredient named "Flour" so a catalog search proves
 * it is filtering by household rather than getting lucky on the name.
 */
export async function seedHousehold(name: string): Promise<SeededHousehold> {
  const db = testDb();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return db.transaction(async (tx) => {
    const [householdRow] = await tx.insert(household).values({ name }).returning();
    if (householdRow === undefined) throw new Error("seed: no household row");

    const [userRow] = await tx
      .insert(user)
      .values({
        email: `owner@${slug}.example`,
        // Not a credential: a literal standing in for a hash the auth slice
        // will produce. Nothing verifies it.
        passwordHash: "placeholder-not-a-real-hash",
        householdId: householdRow.id,
      })
      .returning();
    if (userRow === undefined) throw new Error("seed: no user row");

    const [inviteRow] = await tx
      .insert(invite)
      .values({
        householdId: householdRow.id,
        tokenHash: `token-hash-${slug}`,
        createdBy: userRow.id,
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      })
      .returning();
    if (inviteRow === undefined) throw new Error("seed: no invite row");

    const [ingredientRow] = await tx
      .insert(ingredient)
      .values({ householdId: householdRow.id, name: "Flour", densityGPerMl: 0.53 })
      .returning();
    if (ingredientRow === undefined) throw new Error("seed: no ingredient row");

    const [pantryRow] = await tx
      .insert(pantryItem)
      .values({
        householdId: householdRow.id,
        ingredientId: ingredientRow.id,
        quantity: 500,
        unitId: "g",
      })
      .returning();
    if (pantryRow === undefined) throw new Error("seed: no pantry row");

    const [recipeRow] = await tx
      .insert(recipe)
      .values({
        householdId: householdRow.id,
        name: `${name} bread`,
        baseServings: 4,
        steps: ["Mix", "Bake"],
      })
      .returning();
    if (recipeRow === undefined) throw new Error("seed: no recipe row");

    await tx.insert(recipeIngredient).values({
      householdId: householdRow.id,
      recipeId: recipeRow.id,
      ingredientId: ingredientRow.id,
      quantity: 300,
      unitId: "g",
    });

    return {
      householdId: householdRow.id,
      userId: userRow.id,
      inviteId: inviteRow.id,
      ingredientId: ingredientRow.id,
      pantryItemId: pantryRow.id,
      recipeId: recipeRow.id,
    };
  });
}
