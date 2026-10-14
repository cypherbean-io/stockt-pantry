import type { Page } from "@playwright/test";

/**
 * Putting data in front of a spec **through the app's own forms**.
 *
 * The same reasoning `global-setup.ts` gives for signing up through `/signup`:
 * rows inserted behind the app's back make a spec green on a build whose forms
 * are broken, and they skip the validation and unit handling a real row went
 * through. These are slower than an `INSERT` and that is the trade.
 *
 * Nothing here types a credential — every caller already holds a session — so
 * it is safe to run inside a traced, error-contexted spec.
 *
 * Names are the caller's to make unique. Every spec in a run shares one
 * household (`fullyParallel`), and a pantry entry or catalog ingredient named
 * twice is a different request from one named once.
 */

export type RecipeLine = {
  readonly ingredient: string;
  readonly quantity: string;
  /** A unit id from `src/lib/matching/units.ts` — the `<option>` value, e.g. `"g"`, `"ml"`. */
  readonly unit: string;
};

/**
 * Whatever a form said instead of navigating. The messages are a fixed set in
 * `src/app/actions/` and none of them echoes a submitted value.
 *
 * Only alerts with text: Next's route announcer is a `role="alert"` that is
 * empty until a navigation announces itself, and it would otherwise be the one
 * this finds — reporting "The form said: " and nothing.
 */
async function refusal(page: Page): Promise<string> {
  const alert = await page
    .getByRole("alert")
    .filter({ hasText: /\S/ })
    .first()
    .textContent({ timeout: 1_000 })
    .catch(() => undefined);

  return alert === undefined || alert === null ? "" : ` The form said: ${alert.trim()}`;
}

/**
 * Saves a recipe through `/recipes/new` and answers its id — once its own page
 * has rendered it, not merely once the URL has changed.
 *
 * The difference matters. The action redirects to `/recipes/<id>`, and the
 * router lands on that URL even if the page there renders the not-found
 * boundary instead. Waiting on the URL alone would hand `not-found.spec.ts` an
 * id that 404s for its own owner — under which "foreign looks like missing"
 * holds trivially — and hand `mobile.spec.ts` a 404 page to measure.
 */
export async function addRecipe(
  page: Page,
  recipe: { readonly name: string; readonly lines: readonly RecipeLine[] },
): Promise<string> {
  if (recipe.lines.length === 0) {
    throw new Error("The recipe form requires at least one ingredient line.");
  }

  await page.goto("/recipes/new");
  await page.getByLabel("Recipe name").fill(recipe.name);

  // The form opens with two blank rows, every input in them `required`.
  for (let index = 2; index < recipe.lines.length; index++) {
    await page.getByRole("button", { name: "Add another ingredient" }).click();
  }
  if (recipe.lines.length === 1) {
    await page.getByRole("button", { name: "Remove ingredient 2" }).click();
  }

  for (const [index, line] of recipe.lines.entries()) {
    const row = index + 1;
    await page.getByLabel(`Ingredient ${row} name`, { exact: true }).fill(line.ingredient);
    await page.getByLabel(`Ingredient ${row} quantity`, { exact: true }).fill(line.quantity);
    await page.getByLabel(`Ingredient ${row} unit`, { exact: true }).selectOption(line.unit);
  }

  await page.getByRole("button", { name: "Save recipe" }).click();

  const saved = /\/recipes\/([0-9a-f-]{36})$/;
  try {
    await page.waitForURL(saved, { timeout: 30_000 });
    await page
      .getByRole("heading", { level: 1, name: recipe.name, exact: true })
      .waitFor({ timeout: 30_000 });
  } catch (cause) {
    throw new Error(
      `Saving the recipe "${recipe.name}" did not show on its own page.${await refusal(page)}`,
      { cause },
    );
  }

  const id = saved.exec(new URL(page.url()).pathname)?.[1];
  if (id === undefined) throw new Error(`No recipe id in ${page.url()}`);
  return id;
}

/** Puts a new catalog ingredient on the shelf through `/pantry`. */
export async function addPantryItem(
  page: Page,
  item: {
    readonly ingredient: string;
    readonly quantity: string;
    readonly unit: string;
    readonly density?: string;
  },
): Promise<void> {
  await page.goto("/pantry");

  // Scoped to the add form: every row on the shelf renders its own "Amount"
  // and "Unit", so an unscoped label would match one per item.
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save to pantry" }) });

  // An empty catalog preselects this; a populated one preselects its first entry.
  await form
    .getByLabel("Ingredient", { exact: true })
    .selectOption({ label: "Add a new ingredient…" });
  await form.getByLabel("New ingredient name").fill(item.ingredient);
  if (item.density !== undefined) {
    await form.getByLabel("Density in g/mL (optional)").fill(item.density);
  }
  await form.getByLabel("Amount").fill(item.quantity);
  await form.getByLabel("Unit").selectOption(item.unit);
  await form.getByRole("button", { name: "Save to pantry" }).click();

  // The action answers by refreshing the page, not by navigating: the new row's
  // own heading is the signal that it landed.
  try {
    await page
      .getByRole("heading", { level: 3, name: item.ingredient, exact: true })
      .waitFor({ timeout: 30_000 });
  } catch (cause) {
    const said = await refusal(page);
    throw new Error(`"${item.ingredient}" did not appear on the pantry shelf.${said}`, { cause });
  }
}

const FOREIGN_RECIPE_VAR = "E2E_FOREIGN_RECIPE_ID";

/**
 * What the second household calls its recipe — and what must never reach the
 * shared session. Nothing in it that HTML escapes: `not-found.spec.ts` searches
 * the served bytes for it, and an apostrophe arrives there as `&#x27;`, which
 * would make that search pass whatever the page contained.
 */
export const FOREIGN_RECIPE_NAME = "Foreign household recipe";

/** The one line in it, for the same reason. */
export const FOREIGN_INGREDIENT_NAME = "Foreign household ingredient";

/**
 * A recipe that exists, in a household the shared session is not a member of.
 *
 * `global-setup.ts` signs that household up and saves the recipe, because doing
 * it means typing a password, which no spec does (see the note there). It
 * hands the id over through the environment — workers are spawned after global
 * setup and inherit it, which is the mechanism Playwright documents for this
 * and the one `credentials.ts` already relies on.
 */
export function recordForeignRecipe(id: string): void {
  process.env[FOREIGN_RECIPE_VAR] = id;
}

export function foreignRecipeId(): string {
  const id = process.env[FOREIGN_RECIPE_VAR];
  if (id === undefined || id === "") {
    throw new Error(
      `${FOREIGN_RECIPE_VAR} is unset: global-setup.ts did not seed the second household.`,
    );
  }
  return id;
}
