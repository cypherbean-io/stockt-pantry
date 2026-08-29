import { asc, eq } from "drizzle-orm";

import { getDb } from "../client";
import { ingredient, pantryItem, type PantryItemRow } from "../schema";
import { ownedBy, type HouseholdScope } from "../scope";
import { assertPositiveQuantity } from "../validate";
import type { UnitKey } from "@/lib/matching/units";

/**
 * Pantry reads and writes, all scoped to one household (SPEC.md §4).
 *
 * The mutating functions report whether they actually touched a row rather
 * than throwing. A caller acting on another household's id is not an error
 * condition to surface — it should look exactly like acting on an id that does
 * not exist, so the response cannot be used to probe for which ids are real.
 */

export type PantryEntry = {
  readonly ingredientId: string;
  readonly quantity: number;
  readonly unitId: UnitKey;
};

export async function listPantryItems(scope: HouseholdScope): Promise<PantryItemRow[]> {
  return getDb()
    .select()
    .from(pantryItem)
    .where(ownedBy(scope, pantryItem))
    .orderBy(asc(pantryItem.createdAt));
}

export async function findPantryItemById(
  scope: HouseholdScope,
  id: string,
): Promise<PantryItemRow | undefined> {
  const rows = await getDb()
    .select()
    .from(pantryItem)
    .where(ownedBy(scope, pantryItem, eq(pantryItem.id, id)))
    .limit(1);
  return rows[0];
}

/**
 * The pantry joined to its catalog entries — the shape the matching engine
 * needs. The join is scoped on both sides; the composite foreign key already
 * makes a cross-household pair unstorable, but the predicate does not rely on
 * that holding.
 */
export async function listPantryWithIngredients(scope: HouseholdScope): Promise<
  readonly {
    readonly item: PantryItemRow;
    readonly ingredient: typeof ingredient.$inferSelect;
  }[]
> {
  const rows = await getDb()
    .select({ item: pantryItem, ingredient })
    .from(pantryItem)
    .innerJoin(ingredient, eq(ingredient.id, pantryItem.ingredientId))
    .where(ownedBy(scope, pantryItem, ownedBy(scope, ingredient)))
    .orderBy(asc(ingredient.name));
  return rows;
}

/**
 * Insert or replace the household's row for one ingredient. There is at most
 * one pantry row per ingredient (see the unique constraint in the schema), so
 * "add flour" and "correct the flour amount" are the same operation.
 */
export async function setPantryEntry(
  scope: HouseholdScope,
  entry: PantryEntry,
): Promise<PantryItemRow> {
  const quantity = assertPositiveQuantity(entry.quantity, "Quantity");

  const rows = await getDb()
    .insert(pantryItem)
    .values({
      householdId: scope.householdId,
      ingredientId: entry.ingredientId,
      quantity,
      unitId: entry.unitId,
    })
    .onConflictDoUpdate({
      target: [pantryItem.householdId, pantryItem.ingredientId],
      set: { quantity, unitId: entry.unitId },
    })
    .returning();

  const saved = rows[0];
  if (saved === undefined) {
    throw new Error("Upsert returned no pantry row");
  }
  return saved;
}

/** Returns the updated row, or undefined if the id is not this household's. */
export async function setPantryQuantity(
  scope: HouseholdScope,
  id: string,
  quantity: number,
  unitId: UnitKey,
): Promise<PantryItemRow | undefined> {
  const rows = await getDb()
    .update(pantryItem)
    .set({ quantity: assertPositiveQuantity(quantity, "Quantity"), unitId })
    .where(ownedBy(scope, pantryItem, eq(pantryItem.id, id)))
    .returning();
  return rows[0];
}

/** Returns whether a row was removed. False for another household's id. */
export async function deletePantryItem(scope: HouseholdScope, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(pantryItem)
    .where(ownedBy(scope, pantryItem, eq(pantryItem.id, id)))
    .returning({ id: pantryItem.id });
  return rows.length > 0;
}
