import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addPantryItem, addRecipe } from "./seed";

/**
 * Setting the density of an ingredient that is already in the catalog, from
 * its row on `/pantry`.
 *
 * `pantry-flow.db.test.ts` covers the flow and `screens.test.tsx` the markup.
 * What neither can show is the wiring: that the row's form reaches the action,
 * that the action's `refresh()` redraws the row with the saved value, and that
 * a recipe line which could not be checked before can be now.
 *
 * The status words are written out rather than imported from `ui/badge.tsx`,
 * for the reason `buckets.spec.ts` gives: an expectation derived from the code
 * under test cannot catch that code being wrong. Names are suffixed because
 * every spec in a run shares one household.
 */

/** The recipe page's line for one ingredient, in the from-`sm` table layout. */
function recipeLine(page: Page, ingredient: string): Locator {
  return page
    .getByRole("table", { name: "Ingredients against the pantry" })
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: ingredient, exact: true }) });
}

/** The pantry row for one ingredient, found by its own heading. */
function pantryRow(page: Page, ingredient: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: ingredient, exact: true }) });
}

test("setting a density on the shelf lets a weight be checked against a volume", async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 8);
  const rice = `Basmati rice ${tag}`;

  // 250 mL held and no density, against a line wanting 200 g.
  await addPantryItem(page, { ingredient: rice, quantity: "250", unit: "ml" });
  const recipeId = await addRecipe(page, {
    name: `Pilau ${tag}`,
    lines: [{ ingredient: rice, quantity: "200", unit: "g" }],
  });

  await expect(recipeLine(page, rice)).toContainText("can't verify without a density");

  await page.goto("/pantry");
  const row = pantryRow(page, rice);
  await row.getByText("Edit density", { exact: true }).click();
  await row.getByLabel("Density in g/mL (optional)").fill("0.85");
  await row.getByRole("button", { name: "Save density" }).click();

  // The refresh redraws the row from the saved entry.
  await expect(pantryRow(page, rice)).toContainText("0.85 g/mL");

  // 250 mL at 0.85 g/mL is 212.5 g, against 200 g wanted.
  await page.goto(`/recipes/${recipeId}`);
  await expect(recipeLine(page, rice)).toContainText("have enough");
});
