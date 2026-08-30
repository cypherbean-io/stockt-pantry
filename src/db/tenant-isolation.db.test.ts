import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ingredient, invite, pantryItem, recipe, recipeIngredient, session, user } from "./schema";
import { unsafeHouseholdScopeFromId, type HouseholdScope } from "./scope";
import { findHousehold, listMembers } from "./queries/household";
import { createInvite, listInvites, findInviteById } from "./queries/invites";
import {
  createIngredient,
  findIngredientById,
  findIngredientByName,
  findOrCreateIngredient,
  listIngredients,
  searchIngredients,
} from "./queries/ingredients";
import {
  deletePantryItem,
  findPantryItemById,
  listPantryItems,
  listPantryWithIngredients,
  setPantryEntry,
  setPantryQuantity,
} from "./queries/pantry";
import {
  createRecipe,
  deleteRecipe,
  findRecipeById,
  findRecipeWithLines,
  listRecipes,
  listRecipesWithLines,
} from "./queries/recipes";
import { resetDatabase, seedHousehold, testDb, type SeededHousehold } from "./testing/harness";

const db = testDb();

/** The fields postgres.js copies off the wire's ErrorResponse. */
type PostgresError = Error & {
  readonly code?: string;
  readonly constraint_name?: string;
};

const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/**
 * Await a query that must be rejected and hand back the driver's error.
 *
 * Drizzle wraps driver errors in a `Failed query: ...` message and hangs the
 * real one off `cause`, so the SQLSTATE is not reachable from the outer error.
 */
async function rejection(query: Promise<unknown>): Promise<PostgresError> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return (cause ?? error) as PostgresError;
  }
  throw new Error("Expected the query to be rejected, but it succeeded");
}

/**
 * The one invariant that must never be violated (CLAUDE.md, SPEC.md §4): a
 * session scoped to one household cannot reach another household's rows, even
 * with a correctly-guessed primary key.
 *
 * Every test here follows the same shape — act as household A, pass an id that
 * belongs to household B, and assert both that nothing came back and that B's
 * row is still intact. "Returned nothing" alone would also be satisfied by a
 * query that deleted the row and then found nothing.
 */

let alpha: SeededHousehold;
let beta: SeededHousehold;
let scopeA: HouseholdScope;
let scopeB: HouseholdScope;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  alpha = await seedHousehold("Alpha");
  beta = await seedHousehold("Beta");
  scopeA = unsafeHouseholdScopeFromId(alpha.householdId);
  scopeB = unsafeHouseholdScopeFromId(beta.householdId);
});

describe("household and members", () => {
  it("resolves only the scope's own household", async () => {
    expect((await findHousehold(scopeA))?.id).toBe(alpha.householdId);
    expect((await findHousehold(scopeB))?.id).toBe(beta.householdId);
  });

  it("lists only the scoped household's members", async () => {
    const mine = await listMembers(scopeA);

    expect(mine.map((row) => row.id)).toEqual([alpha.userId]);
  });

  it("never hands a password hash to a caller", async () => {
    // The member list renders into a page, and server component props are
    // serialised into the HTML payload.
    const [member] = await listMembers(scopeA);

    expect(member).toBeDefined();
    expect(member && "passwordHash" in member).toBe(false);
    expect(JSON.stringify(await listMembers(scopeA))).not.toContain("placeholder-not-a-real-hash");
  });
});

describe("ingredient catalog", () => {
  it("lists only the scoped household's ingredients", async () => {
    const mine = await listIngredients(scopeA);

    expect(mine.map((row) => row.id)).toEqual([alpha.ingredientId]);
  });

  it("does not return another household's ingredient by id", async () => {
    expect(await findIngredientById(scopeA, beta.ingredientId)).toBeUndefined();
  });

  it("only surfaces the current household's catalog when searching by name", async () => {
    // Both households named their ingredient "Flour"; import-mapping lookups
    // must not offer one household's entry to the other (SPEC.md §5).
    const hits = await searchIngredients(scopeA, "flour");

    expect(hits.map((row) => row.householdId)).toEqual([alpha.householdId]);
  });

  it("stamps a new ingredient with the scope's household, not a caller-supplied one", async () => {
    const created = await createIngredient(scopeA, { name: "Semolina" });

    expect(created.householdId).toBe(alpha.householdId);
    expect(await findIngredientById(scopeB, created.id)).toBeUndefined();
  });

  it("does not return another household's ingredient by name", async () => {
    // Both households named their entry "Flour", so an unscoped exact-name
    // lookup would return whichever row Postgres reached first.
    expect((await findIngredientByName(scopeA, "Flour"))?.id).toBe(alpha.ingredientId);
    expect((await findIngredientByName(scopeB, "Flour"))?.id).toBe(beta.ingredientId);
  });

  it("finds nothing by a name only another household uses", async () => {
    await createIngredient(scopeB, { name: "Semolina" });

    expect(await findIngredientByName(scopeA, "Semolina")).toBeUndefined();
  });

  it("creates into the scope's household when the name is new to it", async () => {
    const entry = await findOrCreateIngredient(scopeA, { name: "Semolina" });

    expect(entry.householdId).toBe(alpha.householdId);
    expect(await findIngredientById(scopeB, entry.id)).toBeUndefined();
  });

  it("returns its own entry rather than the other household's identical one", async () => {
    // The unique constraint is on (household_id, name), so "already taken" is
    // a per-household question. Resolving it against the wrong household would
    // hand a caller a catalog id it must never see.
    const entry = await findOrCreateIngredient(scopeA, { name: "Flour" });

    expect(entry.id).toBe(alpha.ingredientId);
  });

  it("creates its own entry even though the other household has that name", async () => {
    await createIngredient(scopeB, { name: "Semolina" });

    const entry = await findOrCreateIngredient(scopeA, { name: "Semolina" });

    expect(entry.householdId).toBe(alpha.householdId);
    expect(await listIngredients(scopeB)).toHaveLength(2);
  });

  it("keeps the density of an entry that already exists", async () => {
    // SPEC.md §2 puts editing densities of existing ingredients out of scope,
    // so resolving a name must not be a back door into overwriting one.
    const resolved = await findOrCreateIngredient(scopeA, { name: "Flour", densityGPerMl: 9 });

    expect(resolved.densityGPerMl).toBe(0.53);
  });
});

describe("pantry items", () => {
  it("lists only the scoped household's pantry", async () => {
    const mine = await listPantryItems(scopeA);

    expect(mine.map((row) => row.id)).toEqual([alpha.pantryItemId]);
  });

  it("does not return another household's pantry item by id", async () => {
    expect(await findPantryItemById(scopeA, beta.pantryItemId)).toBeUndefined();
  });

  it("does not update another household's pantry item", async () => {
    const updated = await setPantryQuantity(scopeA, beta.pantryItemId, 999, "g");

    expect(updated).toBeUndefined();
    const untouched = await findPantryItemById(scopeB, beta.pantryItemId);
    expect(untouched?.quantity).toBe(500);
  });

  it("does not delete another household's pantry item", async () => {
    const deleted = await deletePantryItem(scopeA, beta.pantryItemId);

    expect(deleted).toBe(false);
    expect(await findPantryItemById(scopeB, beta.pantryItemId)).toBeDefined();
  });

  it("joins the pantry to the catalog without crossing households", async () => {
    // Both households hold a "Flour" row, so an unscoped join would return
    // four rows rather than one.
    const joined = await listPantryWithIngredients(scopeA);

    expect(joined).toHaveLength(1);
    expect(joined[0]?.item.householdId).toBe(alpha.householdId);
    expect(joined[0]?.ingredient.householdId).toBe(alpha.householdId);
  });

  it("cannot stock another household's ingredient", async () => {
    const error = await rejection(
      setPantryEntry(scopeA, { ingredientId: beta.ingredientId, quantity: 1, unitId: "g" }),
    );

    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("upserting its own entry leaves the other household's identical entry alone", async () => {
    // The conflict target is (household_id, ingredient_id). If it were
    // ingredient_id alone this would overwrite Beta's flour.
    await setPantryEntry(scopeA, {
      ingredientId: alpha.ingredientId,
      quantity: 42,
      unitId: "g",
    });

    expect((await findPantryItemById(scopeA, alpha.pantryItemId))?.quantity).toBe(42);
    expect((await findPantryItemById(scopeB, beta.pantryItemId))?.quantity).toBe(500);
  });
});

describe("recipes", () => {
  it("lists only the scoped household's recipes", async () => {
    const mine = await listRecipes(scopeA);

    expect(mine.map((row) => row.id)).toEqual([alpha.recipeId]);
  });

  it("does not return another household's recipe by id", async () => {
    expect(await findRecipeById(scopeA, beta.recipeId)).toBeUndefined();
  });

  it("does not return another household's recipe ingredient lines", async () => {
    // recipe_ingredient carries no id of its own in the URL space, so the leak
    // to guard is reading B's lines through a guessed recipe id.
    expect(await findRecipeWithLines(scopeA, beta.recipeId)).toBeUndefined();
  });

  it("returns its own recipe's ingredient lines", async () => {
    const found = await findRecipeWithLines(scopeA, alpha.recipeId);

    expect(found?.lines).toHaveLength(1);
    expect(found?.lines[0]?.line.ingredientId).toBe(alpha.ingredientId);
  });

  it("joins recipe lines to the catalog without crossing households", async () => {
    // Both households have a recipe with one "Flour" line. An unscoped join on
    // ingredient_id alone would attach Beta's catalog entry to Alpha's line.
    const found = await findRecipeWithLines(scopeA, alpha.recipeId);

    expect(found?.lines[0]?.ingredient.householdId).toBe(alpha.householdId);
  });

  it("lists only the scoped household's recipes when listing them with their lines", async () => {
    const listed = await listRecipesWithLines(scopeA);

    expect(listed.map((row) => row.id)).toEqual([alpha.recipeId]);
    expect(listed.flatMap((row) => row.lines).map((line) => line.ingredient.householdId)).toEqual([
      alpha.householdId,
    ]);
  });

  it("treats a malformed recipe id as one this household does not have", async () => {
    // The id comes off a URL segment. Postgres rejects a bad `uuid` literal
    // outright rather than matching nothing, so without a shape check
    // `/recipes/nonsense` is a 500 with the statement in the log.
    expect(await findRecipeWithLines(scopeA, "'; drop table recipe; --")).toBeUndefined();
  });

  it("does not delete anything when given a malformed recipe id", async () => {
    expect(await deleteRecipe(scopeA, "not-a-uuid")).toBe(false);
    expect(await listRecipes(scopeA)).toHaveLength(1);
  });

  it("does not delete another household's recipe", async () => {
    const deleted = await deleteRecipe(scopeA, beta.recipeId);

    expect(deleted).toBe(false);
    expect(await findRecipeById(scopeB, beta.recipeId)).toBeDefined();
  });

  it("cannot save a recipe whose line references another household's ingredient", async () => {
    await expect(
      createRecipe(scopeA, {
        name: "Borrowed flour",
        baseServings: 2,
        steps: [],
        ingredients: [{ ingredientId: beta.ingredientId, quantity: 1, unitId: "g" }],
      }),
    ).rejects.toThrow();
  });

  it("leaves no half-saved recipe behind when a line is rejected", async () => {
    // The import flow saves the recipe and its lines together (SPEC.md §3);
    // a rejected line must take the whole recipe with it.
    await expect(
      createRecipe(scopeA, {
        name: "Borrowed flour",
        baseServings: 2,
        steps: [],
        ingredients: [{ ingredientId: beta.ingredientId, quantity: 1, unitId: "g" }],
      }),
    ).rejects.toThrow();

    const names = (await listRecipes(scopeA)).map((row) => row.name);
    expect(names).not.toContain("Borrowed flour");
  });

  it("stamps a saved recipe and its lines with the scope's household", async () => {
    const saved = await createRecipe(scopeA, {
      name: "Own flour",
      baseServings: 2,
      steps: ["Mix"],
      ingredients: [{ ingredientId: alpha.ingredientId, quantity: 1, unitId: "g" }],
    });

    expect(saved.householdId).toBe(alpha.householdId);
    expect(saved.ingredients.map((line) => line.householdId)).toEqual([alpha.householdId]);
    expect(await findRecipeById(scopeB, saved.id)).toBeUndefined();
  });
});

describe("invites", () => {
  it("lists only the scoped household's invites", async () => {
    const mine = await listInvites(scopeA);

    expect(mine.map((row) => row.id)).toEqual([alpha.inviteId]);
  });

  it("does not return another household's invite by id", async () => {
    expect(await findInviteById(scopeA, beta.inviteId)).toBeUndefined();
  });

  it("issues a new invite into the scope's household, not a caller-supplied one", async () => {
    const created = await createInvite(scopeA, {
      tokenHash: "hash-of-a-fresh-token",
      createdBy: alpha.userId,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });

    expect(created.householdId).toBe(alpha.householdId);
    expect(await findInviteById(scopeB, created.id)).toBeUndefined();
  });

  it("cannot issue an invite crediting another household's member", async () => {
    // `createdBy` is the one caller-supplied id on this path. The composite key
    // is what stops it naming someone outside the scope's household.
    const error = await rejection(
      createInvite(scopeA, {
        tokenHash: "hash-of-a-borrowed-token",
        createdBy: beta.userId,
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      }),
    );

    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(error.constraint_name).toBe("invite_household_created_by_fk");
  });

  it("never hands the token hash back to a caller", async () => {
    // The redeem path looks an invite up *by* its token hash; a list query that
    // returned it would put a working invite into whatever renders the page.
    await createInvite(scopeA, {
      tokenHash: "hash-that-must-not-escape",
      createdBy: alpha.userId,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });

    const listed = await listInvites(scopeA);
    expect(JSON.stringify(listed)).not.toContain("hash-that-must-not-escape");
    expect(listed.every((row) => !("tokenHash" in row))).toBe(true);
  });
});

describe("database-level cross-tenant integrity", () => {
  /**
   * The query layer is the control; these constraints are the backstop. A bug
   * that writes a row pointing at another household's ingredient should fail
   * in Postgres rather than produce a silently cross-linked catalog.
   *
   * Assertions name the SQLSTATE and the constraint rather than matching the
   * error text, so "some insert failed" cannot pass for "this constraint
   * fired" — a not-null violation would otherwise satisfy a looser check.
   */

  it("refuses a pantry item pointing at another household's ingredient", async () => {
    const error = await rejection(
      db.insert(pantryItem).values({
        householdId: alpha.householdId,
        ingredientId: beta.ingredientId,
        quantity: 1,
        unitId: "g",
      }),
    );

    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(error.constraint_name).toBe("pantry_item_household_ingredient_fk");
  });

  it("refuses a recipe line pointing at another household's ingredient", async () => {
    const error = await rejection(
      db.insert(recipeIngredient).values({
        householdId: alpha.householdId,
        recipeId: alpha.recipeId,
        ingredientId: beta.ingredientId,
        quantity: 1,
        unitId: "g",
      }),
    );

    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(error.constraint_name).toBe("recipe_ingredient_household_ingredient_fk");
  });

  it("refuses a recipe line attached to another household's recipe", async () => {
    const error = await rejection(
      db.insert(recipeIngredient).values({
        householdId: alpha.householdId,
        recipeId: beta.recipeId,
        ingredientId: alpha.ingredientId,
        quantity: 1,
        unitId: "g",
      }),
    );

    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(error.constraint_name).toBe("recipe_ingredient_household_recipe_fk");
  });

  it("refuses a session claiming a household its user is not in", async () => {
    // `session.household_id` is denormalised so resolving a cookie to a scope
    // needs no join. This is the constraint that makes that safe: a session row
    // cannot assert a household its member does not belong to, so the
    // denormalised column cannot drift into a cross-tenant scope.
    const error = await rejection(
      db.insert(session).values({
        tokenHash: "hash-of-a-forged-session",
        userId: alpha.userId,
        householdId: beta.householdId,
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      }),
    );

    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(error.constraint_name).toBe("session_household_user_fk");
  });

  it("revokes a member's sessions and invites when the member is deleted", async () => {
    await db.insert(session).values({
      tokenHash: "hash-of-alphas-session",
      userId: alpha.userId,
      householdId: alpha.householdId,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });

    await db.delete(user).where(eq(user.id, alpha.userId));

    expect(await db.select().from(session)).toHaveLength(0);
    // invite.created_by cascades for the same reason: removing someone revokes
    // what they issued.
    expect((await db.select().from(invite)).map((row) => row.householdId)).toEqual([
      beta.householdId,
    ]);
  });

  it("rejects a zero quantity at the data-entry layer", async () => {
    // CLAUDE.md conventions: the matching engine assumes valid input, so the
    // rejection has to happen here.
    const error = await rejection(
      db.insert(pantryItem).values({
        householdId: alpha.householdId,
        ingredientId: alpha.ingredientId,
        quantity: 0,
        unitId: "g",
      }),
    );

    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint_name).toBe("pantry_item_quantity_positive");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a %s pantry quantity, which `> 0` alone lets through", async (_label, value) => {
    // Postgres sorts NaN above every float, so `'NaN'::float8 > 0` is true and
    // so is `Infinity > 0`. Without the upper bound in the CHECK, both store
    // cleanly and then make the matching engine report "have" for an
    // ingredient nobody has.
    const error = await rejection(
      db.insert(pantryItem).values({
        householdId: alpha.householdId,
        ingredientId: alpha.ingredientId,
        quantity: value,
        unitId: "g",
      }),
    );

    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint_name).toBe("pantry_item_quantity_positive");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a %s ingredient density", async (_label, value) => {
    // A NaN density is worse than a missing one: it slips past the `<= 0`
    // guard in `convert` and yields NaN instead of the "can't verify" null the
    // spec requires.
    const error = await rejection(
      db.insert(ingredient).values({
        householdId: alpha.householdId,
        name: "Dubious",
        densityGPerMl: value,
      }),
    );

    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint_name).toBe("ingredient_density_positive");
  });

  it("still accepts an ordinary fractional quantity", async () => {
    // The upper bound must not have made the constraint over-strict.
    const saved = await setPantryEntry(scopeA, {
      ingredientId: alpha.ingredientId,
      quantity: 1.5,
      unitId: "g",
    });

    expect(saved.quantity).toBe(1.5);
  });

  it("rejects a negative recipe quantity at the data-entry layer", async () => {
    const error = await rejection(
      db.insert(recipeIngredient).values({
        householdId: alpha.householdId,
        recipeId: alpha.recipeId,
        ingredientId: alpha.ingredientId,
        quantity: -1,
        unitId: "g",
      }),
    );

    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint_name).toBe("recipe_ingredient_quantity_positive");
  });

  it("removes a recipe's lines when the recipe goes, without touching the catalog", async () => {
    await deleteRecipe(scopeA, alpha.recipeId);

    expect(await db.select().from(recipeIngredient)).toHaveLength(1); // beta's
    expect(await db.select().from(recipe)).toHaveLength(1);
    expect(await db.select().from(ingredient)).toHaveLength(2);
  });
});

describe("scope construction", () => {
  it("refuses to build a scope from something that is not a household id", () => {
    expect(() => unsafeHouseholdScopeFromId("' OR 1=1 --")).toThrow(/household id/i);
  });

  it("refuses to build a scope from an empty string", () => {
    expect(() => unsafeHouseholdScopeFromId("")).toThrow(/household id/i);
  });
});
