import { beforeEach, describe, expect, it } from "vitest";

import { createIngredient } from "./queries/ingredients";
import { listPantryWithIngredients, setPantryEntry } from "./queries/pantry";
import { createRecipe, findRecipeWithLines, listRecipesWithLines } from "./queries/recipes";
import { unsafeHouseholdScopeFromId, type HouseholdScope } from "./scope";
import { resetDatabase, seedHousehold, type SeededHousehold } from "./testing/harness";
import { toPantry, toRecipe } from "@/lib/matching/from-storage";
import { matchRecipe, shoppingList } from "@/lib/matching/match";
import type { LineStatus, MatchResult } from "@/lib/matching/types";
import type { UnitKey } from "@/lib/matching/units";

/**
 * "What can I make" against real rows.
 *
 * `match.test.ts` already covers the algorithm exhaustively off hardcoded
 * fixtures. What it cannot cover is the round trip: that a `unit_id` text
 * column comes back as a conversion factor, that a NULL density becomes
 * "can't verify" rather than zero, and that `double precision` arrives as a JS
 * number rather than a string. Those only break against Postgres.
 */

let alpha: SeededHousehold;
let scope: HouseholdScope;

beforeEach(async () => {
  await resetDatabase();
  alpha = await seedHousehold("Alpha");
  scope = unsafeHouseholdScopeFromId(alpha.householdId);
});

/** A catalog entry the household holds some of. */
async function stock(
  name: string,
  densityGPerMl: number | undefined,
  quantity: number,
  unitId: UnitKey,
): Promise<string> {
  const created = await createIngredient(scope, { name, densityGPerMl });
  await setPantryEntry(scope, { ingredientId: created.id, quantity, unitId });
  return created.id;
}

/** A catalog entry with no pantry row at all. */
async function catalogOnly(name: string, densityGPerMl?: number): Promise<string> {
  return (await createIngredient(scope, { name, densityGPerMl })).id;
}

async function evaluate(recipeId: string, servings?: number): Promise<MatchResult> {
  const stored = await findRecipeWithLines(scope, recipeId);
  if (stored === undefined) throw new Error("the recipe under test was not found");

  return matchRecipe(
    toRecipe(stored, stored.lines),
    toPantry(await listPantryWithIngredients(scope)),
    servings,
  );
}

function statuses(result: MatchResult): Record<string, LineStatus> {
  return Object.fromEntries(result.lines.map((line) => [line.ingredient.name, line.status]));
}

/**
 * The SPEC.md §6 walkthrough, in rows: one line of each outcome, so a single
 * read of the fixture says what every status is meant to prove.
 */
async function seedCookies(): Promise<string> {
  const sugar = await stock("Sugar", 0.85, 2, "cup");
  const egg = await stock("Egg", undefined, 3, "count");
  const chips = await stock("Chocolate chips", undefined, 100, "g");
  const vanilla = await stock("Vanilla extract", undefined, 30, "g");
  const butter = await catalogOnly("Butter", 0.911);

  const saved = await createRecipe(scope, {
    name: "Chocolate chip cookies",
    baseServings: 24,
    steps: ["Cream the butter and sugar", "Fold in the flour", "Bake"],
    ingredients: [
      // 500 g on hand from the seed.
      { ingredientId: alpha.ingredientId, quantity: 300, unitId: "g" },
      // 2 cup on hand, converted through density.
      { ingredientId: sugar, quantity: 200, unitId: "g" },
      { ingredientId: egg, quantity: 2, unitId: "count" },
      // No pantry row.
      { ingredientId: butter, quantity: 225, unitId: "g" },
      // 100 g on hand, 200 g needed.
      { ingredientId: chips, quantity: 200, unitId: "g" },
      // Pantry holds grams, the recipe wants teaspoons, and there is no density.
      { ingredientId: vanilla, quantity: 2, unitId: "tsp" },
    ],
  });

  return saved.id;
}

describe("matching a stored recipe against a stored pantry", () => {
  it("classifies every line by what the household actually holds", async () => {
    const result = await evaluate(await seedCookies());

    expect(statuses(result)).toEqual({
      Flour: "have",
      Sugar: "have",
      Egg: "have",
      Butter: "missing",
      "Chocolate chips": "short",
      "Vanilla extract": "unresolved",
    });
  });

  it("is not makeable while any line is unresolved, short or missing", async () => {
    const result = await evaluate(await seedCookies());

    expect(result.makeable).toBe(false);
  });

  it("converts a stored cup of sugar through the stored density", async () => {
    const result = await evaluate(await seedCookies());
    const sugar = result.lines.find((line) => line.ingredient.name === "Sugar");

    // 2 cup = 473.176473 mL, times 0.85 g/mL.
    expect(sugar?.available).toBeCloseTo(402.2, 1);
  });

  it("reports a stored NULL density as can't-verify rather than as missing", async () => {
    const result = await evaluate(await seedCookies());
    const vanilla = result.lines.find((line) => line.ingredient.name === "Vanilla extract");

    expect(vanilla?.status).toBe("unresolved");
    expect(vanilla?.available).toBeNull();
    expect(vanilla?.shortfall).toBe(0);
  });

  it("reports a fully stocked recipe as makeable", async () => {
    const saved = await createRecipe(scope, {
      name: "Flatbread",
      baseServings: 2,
      steps: ["Mix", "Griddle"],
      ingredients: [{ ingredientId: alpha.ingredientId, quantity: 300, unitId: "g" }],
    });

    const result = await evaluate(saved.id);

    expect(result.makeable).toBe(true);
    expect(shoppingList(result)).toEqual([]);
  });

  it("scales every line with the requested serving count", async () => {
    const recipeId = await seedCookies();

    const doubled = await evaluate(recipeId, 48);
    const flour = doubled.lines.find((line) => line.ingredient.name === "Flour");

    // 300 g at 24 servings is 600 g at 48, against 500 g on hand.
    expect(flour?.required.value).toBe(600);
    expect(flour?.status).toBe("short");
    expect(flour?.shortfall).toBe(100);
  });

  it("lists the missing and short lines with shortfalls in the recipe's unit", async () => {
    const result = await evaluate(await seedCookies());

    expect(
      shoppingList(result).map((line) => ({
        name: line.ingredient.name,
        shortfall: line.shortfall,
        unit: line.required.unit.name,
      })),
    ).toEqual([
      { name: "Butter", shortfall: 225, unit: "g" },
      { name: "Chocolate chips", shortfall: 100, unit: "g" },
    ]);
  });

  it("leaves the pantry untouched when a shopping list is generated", async () => {
    // SPEC.md §3: the shopping list is read-only output; the user re-enters
    // purchases by hand. Nothing on this path may write back.
    const recipeId = await seedCookies();
    const before = await listPantryWithIngredients(scope);

    shoppingList(await evaluate(recipeId));

    expect(await listPantryWithIngredients(scope)).toEqual(before);
  });
});

describe("listing every recipe with its catalog entries", () => {
  it("carries each line's ingredient name and density, so the list page can match", async () => {
    await seedCookies();

    const listed = await listRecipesWithLines(scope);
    const cookies = listed.find((row) => row.name === "Chocolate chip cookies");

    expect(cookies?.lines.map((line) => line.ingredient.name).sort()).toEqual([
      "Butter",
      "Chocolate chips",
      "Egg",
      "Flour",
      "Sugar",
      "Vanilla extract",
    ]);
    expect(
      cookies?.lines.find((line) => line.ingredient.name === "Sugar")?.ingredient.densityGPerMl,
    ).toBe(0.85);
  });

  it("includes a recipe that has no ingredient lines yet", async () => {
    // The grouping is a join in JavaScript; an inner join in SQL would drop
    // this row and the recipe would vanish from the list.
    await createRecipe(scope, {
      name: "Boiled water",
      baseServings: 1,
      steps: ["Boil"],
      ingredients: [],
    });

    const listed = await listRecipesWithLines(scope);

    expect(listed.find((row) => row.name === "Boiled water")?.lines).toEqual([]);
  });
});
