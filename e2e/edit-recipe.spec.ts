import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addPantryItem, addRecipe } from "./seed";

/**
 * Editing a recipe from its own page.
 *
 * `recipe-edit.db.test.ts` covers the flow and `screens.test.tsx` the markup.
 * What neither can show is the wiring: that the recipe page's link reaches a
 * form filled in from the stored recipe, that the form reaches the action, and
 * that the action's redirect lands on a page matched against what was saved.
 *
 * The status words are written out rather than imported from `ui/badge.tsx`,
 * for the reason `buckets.spec.ts` gives. Names are suffixed because every
 * spec in a run shares one household.
 */

/** The recipe page's line for one ingredient, in the from-`sm` table layout. */
function recipeLine(page: Page, ingredient: string): Locator {
  return page
    .getByRole("table", { name: "Ingredients against the pantry" })
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: ingredient, exact: true }) });
}

test("editing a recipe saves over it, and its page is matched against the new version", async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 8);
  const flour = `Strong flour ${tag}`;
  const water = `Spring water ${tag}`;
  const name = `Loaf ${tag}`;

  await addPantryItem(page, { ingredient: flour, quantity: "500", unit: "g" });
  const recipeId = await addRecipe(page, {
    name,
    lines: [{ ingredient: flour, quantity: "300", unit: "g" }],
  });
  await expect(recipeLine(page, flour)).toContainText("have enough");

  await page.getByRole("link", { name: "Edit recipe" }).click();
  await page.waitForURL(new RegExp(`/recipes/${recipeId}/edit$`));

  // Filled in from what was stored, not blank like `/recipes/new`.
  await expect(page.getByLabel("Recipe name")).toHaveValue(name);
  await expect(page.getByLabel("Ingredient 1 name", { exact: true })).toHaveValue(flour);
  await expect(page.getByLabel("Ingredient 1 quantity", { exact: true })).toHaveValue("300");

  await page.getByLabel("Recipe name").fill(`${name} revised`);
  await page.getByLabel("Ingredient 1 quantity", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Add another ingredient" }).click();
  await page.getByLabel("Ingredient 2 name", { exact: true }).fill(water);
  await page.getByLabel("Ingredient 2 quantity", { exact: true }).fill("350");
  await page.getByLabel("Ingredient 2 unit", { exact: true }).selectOption("ml");
  await page.getByRole("button", { name: "Save changes" }).click();

  // The same recipe, not a copy of it.
  await page.waitForURL(new RegExp(`/recipes/${recipeId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} revised`);

  // 500 g held against 600 g now wanted, and the new line is not on the shelf.
  await expect(recipeLine(page, flour)).toContainText("short");
  await expect(recipeLine(page, water)).toContainText("missing");
});
