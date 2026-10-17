import { beforeEach, describe, expect, it } from "vitest";

import { listIngredients } from "./queries/ingredients";
import { createRecipe, findRecipeWithLines } from "./queries/recipes";
import { unsafeHouseholdScopeFromId, type HouseholdScope } from "./scope";
import { resetDatabase, seedHousehold, type SeededHousehold } from "./testing/harness";
import { parseRecipeForm, type RecipeDraft } from "@/lib/recipes/form";
import { updateRecipeDraft } from "@/lib/recipes/service";

/**
 * Editing a recipe against real rows.
 *
 * `form.test.ts` holds the parser to "an untouched save changes nothing", and
 * `tenant-isolation.db.test.ts` holds `updateRecipe` to its scope. What only
 * shows up here is the flow between them: that a confirmed edit replaces the
 * recipe wholesale, that its new names land in this household's catalog, and
 * that a recipe which is not this household's is refused before anything at
 * all is written.
 */

let alpha: SeededHousehold;
let beta: SeededHousehold;
let scope: HouseholdScope;

beforeEach(async () => {
  await resetDatabase();
  alpha = await seedHousehold("Alpha");
  beta = await seedHousehold("Beta");
  scope = unsafeHouseholdScopeFromId(alpha.householdId);
});

/** What the edit form posts, run through the same parser the action uses. */
function edited(fields: Readonly<Record<string, string | readonly string[]>> = {}): RecipeDraft {
  const data = new FormData();
  const values = {
    name: "Seeded loaf",
    baseServings: "2",
    steps: "Autolyse\nShape\nBake",
    ingredientName: ["Flour", "Water"],
    ingredientQuantity: ["500", "350"],
    ingredientUnit: ["g", "ml"],
    ingredientDensity: ["", "1"],
    ...fields,
  };
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value as string]) data.append(key, item);
  }

  const parsed = parseRecipeForm(data);
  if (!parsed.ok) throw new Error(`the edit did not parse: ${JSON.stringify(parsed.fieldErrors)}`);
  return parsed.value;
}

async function catalogNames(): Promise<string[]> {
  return (await listIngredients(scope)).map((row) => row.name);
}

describe("saving an edited recipe", () => {
  it("replaces the name, servings and steps", async () => {
    const saved = await updateRecipeDraft(scope, alpha.recipeId, edited());

    expect(saved).toEqual({ ok: true, id: alpha.recipeId });
    const stored = await findRecipeWithLines(scope, alpha.recipeId);
    expect(stored?.name).toBe("Seeded loaf");
    expect(stored?.baseServings).toBe(2);
    expect(stored?.steps).toEqual(["Autolyse", "Shape", "Bake"]);
  });

  it("replaces the ingredient lines with the ones submitted", async () => {
    await updateRecipeDraft(scope, alpha.recipeId, edited());

    const stored = await findRecipeWithLines(scope, alpha.recipeId);
    expect(
      stored?.lines.map((row) => [row.ingredient.name, row.line.quantity, row.line.unitId]),
    ).toEqual([
      ["Flour", 500, "g"],
      ["Water", 350, "ml"],
    ]);
  });

  it("reuses the catalog entry for a name the household already has", async () => {
    await updateRecipeDraft(scope, alpha.recipeId, edited());

    const stored = await findRecipeWithLines(scope, alpha.recipeId);
    expect(stored?.lines[0]?.line.ingredientId).toBe(alpha.ingredientId);
    expect(await catalogNames()).toEqual(["Flour", "Water"]);
  });

  it("adds a new name to this household's catalog, with the density given for it", async () => {
    await updateRecipeDraft(scope, alpha.recipeId, edited());

    const water = (await listIngredients(scope)).find((row) => row.name === "Water");
    expect(water?.householdId).toBe(alpha.householdId);
    expect(water?.densityGPerMl).toBe(1);
  });

  it("drops a line taken off the list, and keeps its catalog entry", async () => {
    await updateRecipeDraft(
      scope,
      alpha.recipeId,
      edited({
        ingredientName: ["Water"],
        ingredientQuantity: ["350"],
        ingredientUnit: ["ml"],
        ingredientDensity: [""],
      }),
    );

    const stored = await findRecipeWithLines(scope, alpha.recipeId);
    expect(stored?.lines.map((row) => row.ingredient.name)).toEqual(["Water"]);
    expect(await catalogNames()).toContain("Flour");
  });

  it("keeps the page an imported recipe came from", async () => {
    const imported = await createRecipe(scope, {
      name: "Imported loaf",
      baseServings: 4,
      steps: [],
      sourceUrl: "https://example.com/loaf",
      ingredients: [{ ingredientId: alpha.ingredientId, quantity: 300, unitId: "g" }],
    });

    await updateRecipeDraft(scope, imported.id, edited());

    expect((await findRecipeWithLines(scope, imported.id))?.sourceUrl).toBe(
      "https://example.com/loaf",
    );
  });

  it("will not record a source for a typed-in recipe because an edit posted one", async () => {
    // The edit form sends no source field. One arriving anyway is a crafted
    // POST, and an edit is not an import: it cannot claim a provenance.
    await updateRecipeDraft(
      scope,
      alpha.recipeId,
      edited({ sourceUrl: "https://example.com/not-where-this-came-from" }),
    );

    expect((await findRecipeWithLines(scope, alpha.recipeId))?.sourceUrl).toBeNull();
  });

  it("will not repoint an imported recipe's source because an edit posted another", async () => {
    const imported = await createRecipe(scope, {
      name: "Imported loaf",
      baseServings: 4,
      steps: [],
      sourceUrl: "https://example.com/loaf",
      ingredients: [{ ingredientId: alpha.ingredientId, quantity: 300, unitId: "g" }],
    });

    await updateRecipeDraft(scope, imported.id, edited({ sourceUrl: "https://example.com/other" }));

    expect((await findRecipeWithLines(scope, imported.id))?.sourceUrl).toBe(
      "https://example.com/loaf",
    );
  });
});

describe("refusing an edit", () => {
  it("refuses another household's recipe and leaves it untouched", async () => {
    const saved = await updateRecipeDraft(scope, beta.recipeId, edited());

    expect(saved.ok).toBe(false);
    const theirs = await findRecipeWithLines(unsafeHouseholdScopeFromId(beta.householdId), beta.recipeId);
    expect(theirs?.name).toBe("Beta bread");
    expect(theirs?.lines).toHaveLength(1);
  });

  it("adds nothing to the catalog when the recipe is not this household's", async () => {
    // The lines' names resolve into catalog entries before the recipe is
    // written. For a recipe that was never this household's to edit, none of
    // that should happen.
    await updateRecipeDraft(scope, beta.recipeId, edited());

    expect(await catalogNames()).toEqual(["Flour"]);
  });

  it("answers another household's recipe exactly as it answers one that does not exist", async () => {
    const foreign = await updateRecipeDraft(scope, beta.recipeId, edited());
    const missing = await updateRecipeDraft(scope, "00000000-0000-4000-8000-000000000000", edited());

    expect(foreign).toEqual(missing);
  });

  it.each([
    ["a malformed id", "not-a-uuid"],
    ["no id at all", undefined],
    ["a non-string id", 42],
  ])("refuses %s without writing anything", async (_label, id) => {
    const saved = await updateRecipeDraft(scope, id, edited());

    expect(saved.ok).toBe(false);
    expect(await catalogNames()).toEqual(["Flour"]);
  });

  it("leaves the recipe as it was when a line is refused at the data-entry layer", async () => {
    // Past the parser — a draft built by hand — so the query layer's own check
    // is what fires. The recipe must not come out of it half-rewritten.
    const draft: RecipeDraft = {
      ...edited(),
      lines: [{ name: "Flour", quantity: Number.POSITIVE_INFINITY, unitId: "g" }],
    };

    const saved = await updateRecipeDraft(scope, alpha.recipeId, draft);

    expect(saved.ok).toBe(false);
    const stored = await findRecipeWithLines(scope, alpha.recipeId);
    expect(stored?.name).toBe("Alpha bread");
    expect(stored?.lines.map((row) => row.line.quantity)).toEqual([300]);
  });
});
