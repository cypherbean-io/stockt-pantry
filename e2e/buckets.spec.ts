import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addPantryItem, addRecipe } from "./seed";
import { E2E_BASE_URL, E2E_STORAGE_STATE } from "./server";

/**
 * The status-grouped recipe list, against real rows (SPEC.md §5 Smoke 5).
 *
 * `summary.test.ts` already classifies every engine-produced result, and
 * `screens.test.tsx` already checks the grouped markup with no database. What
 * neither can show is the wiring: that `/recipes` groups what the engine
 * actually made of rows saved through the app's own forms — including the
 * grams-against-millilitres line with no density that only a real catalog,
 * real pantry row and real unit conversion produce.
 *
 * The headings are written out rather than imported from `BUCKET_LABEL`, for
 * the reason `shell.spec.ts` gives for its nav labels: an expectation derived
 * from the code under test cannot catch that code being wrong.
 *
 * Every spec in a run shares one household, so other specs' recipes sit in
 * these groups too. Membership is asserted for this file's own recipes, and
 * each count against the rows actually drawn under its heading — never as an
 * absolute number.
 */

const BUCKETS = [
  { heading: "Ready to cook", key: "ready" },
  { heading: "Needs shopping", key: "shopping" },
  { heading: "Partly unverifiable", key: "partly" },
  { heading: "Can't verify", key: "unverifiable" },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

/** This worker's recipe in each bucket, by name. Filled by `beforeAll`. */
const mine = {} as Record<BucketKey, string>;

/**
 * One recipe per bucket, off a two-item pantry:
 *
 * - chickpeas, 500 g held — 200 g is enough, 800 g is short;
 * - rice, 250 mL held and no density — any line in grams cannot be checked.
 *
 * Suffixed so that two workers seeding the shared household at once do not
 * collide, as `mobile.spec.ts` does.
 */
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    storageState: E2E_STORAGE_STATE,
  });

  try {
    const page = await context.newPage();
    const tag = randomUUID().slice(0, 8);
    const chickpeas = `Chickpeas ${tag}`;
    const rice = `Arborio rice ${tag}`;

    await addPantryItem(page, { ingredient: chickpeas, quantity: "500", unit: "g" });
    await addPantryItem(page, { ingredient: rice, quantity: "250", unit: "ml" });

    mine.ready = `Hummus ${tag}`;
    await addRecipe(page, {
      name: mine.ready,
      lines: [{ ingredient: chickpeas, quantity: "200", unit: "g" }],
    });

    mine.shopping = `Falafel ${tag}`;
    await addRecipe(page, {
      name: mine.shopping,
      lines: [{ ingredient: chickpeas, quantity: "800", unit: "g" }],
    });

    mine.partly = `Chickpea risotto ${tag}`;
    await addRecipe(page, {
      name: mine.partly,
      lines: [
        { ingredient: chickpeas, quantity: "800", unit: "g" },
        { ingredient: rice, quantity: "200", unit: "g" },
      ],
    });

    mine.unverifiable = `Risotto bianco ${tag}`;
    await addRecipe(page, {
      name: mine.unverifiable,
      lines: [{ ingredient: rice, quantity: "200", unit: "g" }],
    });
  } finally {
    await context.close();
  }
});

/**
 * `/recipes`, once the list itself is on screen.
 *
 * The route streams its `loading.tsx` skeleton first, and two kinds of check
 * below would pass against that skeleton without looking at a single recipe:
 * a `toHaveCount(0)` ("not in this group") and anything read with a
 * non-retrying call such as `count()` or `allTextContents()`. This file's own
 * Ready to cook recipe arriving is the signal that the grouped list has
 * rendered — the whole page is one server render, so the rest has too.
 */
async function openList(page: Page): Promise<void> {
  await page.goto("/recipes");
  await expect(
    page
      .getByRole("table", { name: "Ready to cook", exact: true })
      .getByRole("rowheader", { name: mine.ready, exact: true }),
  ).toBeVisible();
}

test("groups the recipes under four headings, most actionable first", async ({ page }) => {
  await openList(page);

  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  const texts = await headings.allTextContents();

  // Each heading's own text, in page order: the label first, then the count.
  const order = BUCKETS.map(({ heading }) => texts.findIndex((text) => text.startsWith(heading)));
  expect(order.every((index) => index !== -1), texts.join(" | ")).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

for (const { heading, key } of BUCKETS) {
  test(`files its ${key} recipe under "${heading}" and nowhere else`, async ({ page }) => {
    await openList(page);

    for (const other of BUCKETS) {
      const table = page.getByRole("table", { name: other.heading, exact: true });
      const row = table.getByRole("rowheader", { name: mine[key], exact: true });

      await expect(row).toHaveCount(other.key === key ? 1 : 0);
    }
  });

  test(`counts the rows under "${heading}" in words`, async ({ page }) => {
    await openList(page);

    const group = page.getByRole("region", { name: new RegExp(`^${heading}\\b`) });
    const table = group.getByRole("table", { name: heading, exact: true });
    const rows = await table.getByRole("rowheader").count();

    await expect(group.getByRole("heading", { level: 2 })).toHaveText(
      `${heading} ${rows} ${rows === 1 ? "recipe" : "recipes"}`,
    );
  });

  test(`says "${heading}" in text, not only in colour`, async ({ page }) => {
    // SPEC.md §3.5. The label has to be text a reader — or a screenshot in
    // greyscale — gets, and the glyph beside it has to stay out of the way.
    await openList(page);

    const title = page
      .getByRole("heading", { level: 2 })
      .getByText(heading, { exact: true });

    await expect(title).toBeVisible();
    await expect(title.locator("svg")).toHaveAttribute("aria-hidden", "true");
  });
}
