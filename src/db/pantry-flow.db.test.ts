import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ingredient, pantryItem } from "./schema";
import { unsafeHouseholdScopeFromId, type HouseholdScope } from "./scope";
import { findIngredientByName, listIngredients } from "./queries/ingredients";
import { findPantryItemById, listPantryWithIngredients } from "./queries/pantry";
import { resetDatabase, seedHousehold, testDb, type SeededHousehold } from "./testing/harness";
import { NEW_INGREDIENT } from "@/lib/pantry/entry";
import { removePantryItem, restockPantryItem, stockPantryItem } from "@/lib/pantry/service";

/**
 * The pantry inventory flows against a real Postgres (SPEC.md §2, "Pantry
 * inventory": a per-household list of (ingredient, quantity, unit)).
 *
 * This lives under `src/db/` for the same reason `auth-flow.db.test.ts` does —
 * several assertions are about what is *in the row*, and the lint rule in
 * `eslint.config.mjs` keeps the raw tables out of reach everywhere else.
 *
 * The seeded household already holds one ingredient ("Flour", density 0.53)
 * with 500 g of it in the pantry.
 */

const db = testDb();

let alpha: SeededHousehold;
let beta: SeededHousehold;
let scopeA: HouseholdScope;
let scopeB: HouseholdScope;

/** A well-formed submission for a catalog entry that does not exist yet. */
function newEntry(overrides: Record<string, unknown> = {}) {
  return {
    ingredientId: NEW_INGREDIENT,
    ingredientName: "Caster sugar",
    densityGPerMl: "0.85",
    quantity: "2",
    unitId: "cup",
    ...overrides,
  };
}

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

describe("stocking an item under a new catalog entry", () => {
  it("creates the ingredient and the pantry row together", async () => {
    const result = await stockPantryItem(scopeA, newEntry());

    expect(result.ok).toBe(true);
    const stocked = await listPantryWithIngredients(scopeA);
    expect(stocked.map((row) => [row.ingredient.name, row.item.quantity, row.item.unitId])).toEqual(
      [
        ["Caster sugar", 2, "cup"],
        ["Flour", 500, "g"],
      ],
    );
  });

  it("stores the density it was given, so mass<->volume can resolve later", async () => {
    await stockPantryItem(scopeA, newEntry());

    expect((await findIngredientByName(scopeA, "Caster sugar"))?.densityGPerMl).toBe(0.85);
  });

  it("leaves the density null when the field was blank", async () => {
    // Null is the state that makes a cross-dimension line "can't verify"
    // (SPEC.md §3) — it must not become 0, which `convert` treats the same way
    // but the CHECK constraint rejects.
    await stockPantryItem(scopeA, newEntry({ densityGPerMl: "" }));

    expect((await findIngredientByName(scopeA, "Caster sugar"))?.densityGPerMl).toBeNull();
  });

  it("stamps the new ingredient with the scope's household", async () => {
    await stockPantryItem(scopeA, newEntry());

    expect(await findIngredientByName(scopeB, "Caster sugar")).toBeUndefined();
  });
});

describe("stocking an item under a name already in the catalog", () => {
  it("reuses the existing entry rather than duplicating it", async () => {
    await stockPantryItem(scopeA, newEntry({ ingredientName: "Flour", quantity: "1", unitId: "kg" }));

    expect((await listIngredients(scopeA)).map((row) => row.name)).toEqual(["Flour"]);
  });

  it("does not overwrite the existing entry's density", async () => {
    // v1 has no surface for editing an existing ingredient's density
    // (SPEC.md §2, Out); reaching one through the add form would be one.
    await stockPantryItem(
      scopeA,
      newEntry({ ingredientName: "Flour", densityGPerMl: "9.9", unitId: "g", quantity: "1" }),
    );

    expect((await findIngredientByName(scopeA, "Flour"))?.densityGPerMl).toBe(0.53);
  });

  it("replaces the quantity already on the shelf rather than adding a second row", async () => {
    // There is at most one pantry row per ingredient (schema.ts), so "add
    // flour" and "correct the flour amount" are the same operation.
    await stockPantryItem(scopeA, newEntry({ ingredientName: "Flour", quantity: "1", unitId: "kg" }));

    const rows = await listPantryWithIngredients(scopeA);
    expect(rows).toHaveLength(1);
    expect([rows[0]?.item.quantity, rows[0]?.item.unitId]).toEqual([1, "kg"]);
  });

  it("does not touch the other household's identically-named entry", async () => {
    await stockPantryItem(scopeA, newEntry({ ingredientName: "Flour", quantity: "1", unitId: "kg" }));

    expect((await findPantryItemById(scopeB, beta.pantryItemId))?.quantity).toBe(500);
    expect((await findIngredientByName(scopeB, "Flour"))?.id).toBe(beta.ingredientId);
  });
});

describe("stocking an item against a catalog id", () => {
  it("stocks the household's own catalog entry", async () => {
    const result = await stockPantryItem(scopeA, {
      ingredientId: alpha.ingredientId,
      ingredientName: "",
      densityGPerMl: "",
      quantity: "750",
      unitId: "g",
    });

    expect(result.ok).toBe(true);
    expect((await findPantryItemById(scopeA, alpha.pantryItemId))?.quantity).toBe(750);
  });

  it("refuses another household's catalog id without writing anything", async () => {
    // The composite foreign key would refuse this too, but only by raising a
    // driver error carrying the bound values — which must never escape
    // (CLAUDE.md). The scoped lookup answers first.
    const result = await stockPantryItem(scopeA, {
      ingredientId: beta.ingredientId,
      ingredientName: "",
      densityGPerMl: "",
      quantity: "1",
      unitId: "g",
    });

    expect(result).toMatchObject({ ok: false, error: "unknown-ingredient" });
    expect(await db.select().from(pantryItem)).toHaveLength(2); // the two seeded rows
  });

  it("says nothing about which household the id belonged to", async () => {
    // "Not yours" and "does not exist" have to be one answer, or the response
    // is an oracle for which ids are real (queries/pantry.ts).
    const mine = await stockPantryItem(scopeA, {
      ingredientId: beta.ingredientId,
      ingredientName: "",
      densityGPerMl: "",
      quantity: "1",
      unitId: "g",
    });
    const nobodys = await stockPantryItem(scopeA, {
      ingredientId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      ingredientName: "",
      densityGPerMl: "",
      quantity: "1",
      unitId: "g",
    });

    expect(mine).toEqual(nobodys);
  });
});

describe("rejecting bad input before the database sees it", () => {
  it("rejects a zero quantity as a field error, not a constraint violation", async () => {
    const result = await stockPantryItem(scopeA, newEntry({ quantity: "0" }));

    expect(result).toMatchObject({ ok: false, error: "invalid-input" });
    expect(!result.ok && result.fieldErrors).toMatchObject({ quantity: expect.any(String) });
  });

  it("creates no catalog entry when the quantity is rejected", async () => {
    // The ingredient and the pantry row are one user action; a rejected
    // quantity must not leave a half-finished catalog behind.
    await stockPantryItem(scopeA, newEntry({ quantity: "-1" }));

    expect((await listIngredients(scopeA)).map((row) => row.name)).toEqual(["Flour"]);
  });

  it("rejects an unknown unit rather than failing the foreign key", async () => {
    const result = await stockPantryItem(scopeA, newEntry({ unitId: "furlong" }));

    expect(result).toMatchObject({ ok: false, error: "invalid-input" });
    expect(await db.select().from(ingredient)).toHaveLength(2); // the two seeded rows
  });

  it("rejects a name Postgres could not store", async () => {
    const result = await stockPantryItem(scopeA, newEntry({ ingredientName: "Fl\u0000our" }));

    expect(result).toMatchObject({ ok: false, error: "invalid-input" });
  });
});

describe("correcting the amount on the shelf", () => {
  it("updates the quantity and the unit together", async () => {
    const result = await restockPantryItem(scopeA, {
      id: alpha.pantryItemId,
      quantity: "1.5",
      unitId: "kg",
    });

    expect(result.ok).toBe(true);
    const row = await findPantryItemById(scopeA, alpha.pantryItemId);
    expect([row?.quantity, row?.unitId]).toEqual([1.5, "kg"]);
  });

  it("changes nothing when the id belongs to another household", async () => {
    const result = await restockPantryItem(scopeA, {
      id: beta.pantryItemId,
      quantity: "1",
      unitId: "g",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect((await findPantryItemById(scopeB, beta.pantryItemId))?.quantity).toBe(500);
  });

  it("rejects an id that is not a uuid before it reaches the column", async () => {
    const result = await restockPantryItem(scopeA, {
      id: "not-a-uuid",
      quantity: "1",
      unitId: "g",
    });

    expect(result).toMatchObject({ ok: false, error: "invalid-input" });
  });

  it("rejects an infinite quantity, which would make every recipe look makeable", async () => {
    const result = await restockPantryItem(scopeA, {
      id: alpha.pantryItemId,
      quantity: "Infinity",
      unitId: "g",
    });

    expect(result).toMatchObject({ ok: false, error: "invalid-input" });
    expect((await findPantryItemById(scopeA, alpha.pantryItemId))?.quantity).toBe(500);
  });
});

describe("taking an item off the shelf", () => {
  it("removes the household's own pantry row", async () => {
    const result = await removePantryItem(scopeA, { id: alpha.pantryItemId });

    expect(result).toEqual({ ok: true, value: true });
    expect(await listPantryWithIngredients(scopeA)).toHaveLength(0);
  });

  it("leaves the catalog entry behind, so the ingredient can be restocked", async () => {
    await removePantryItem(scopeA, { id: alpha.pantryItemId });

    expect((await listIngredients(scopeA)).map((row) => row.name)).toEqual(["Flour"]);
  });

  it("removes nothing when the id belongs to another household", async () => {
    const result = await removePantryItem(scopeA, { id: beta.pantryItemId });

    expect(result).toEqual({ ok: true, value: false });
    expect(await findPantryItemById(scopeB, beta.pantryItemId)).toBeDefined();
  });

  it("rejects an id that is not a uuid before it reaches the column", async () => {
    const result = await removePantryItem(scopeA, { id: "'; drop table pantry_item; --" });

    expect(result).toMatchObject({ ok: false, error: "invalid-input" });
    expect(await db.select().from(pantryItem).where(eq(pantryItem.id, alpha.pantryItemId))).toHaveLength(1);
  });
});
