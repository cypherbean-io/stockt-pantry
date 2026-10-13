import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { E2E_FOREIGN_EMAIL, E2E_FOREIGN_HOUSEHOLD_NAME, E2E_HOUSEHOLD_NAME } from "./credentials";
import { expect, test } from "./fixtures";
import { FOREIGN_INGREDIENT_NAME, FOREIGN_RECIPE_NAME, foreignRecipeId } from "./seed";

/**
 * The 404, in a real browser (SPEC.md §5 Smoke 6, §3.7).
 *
 * `route-states.test.tsx` renders `not-found.tsx` on its own and keeps a word
 * list against copy that would explain *why*. What it cannot show is the
 * wiring — that `/recipes/[id]` actually lands here, inside the shell, with the
 * stylesheet — nor the property that matters most: that a recipe belonging to
 * another household is answered byte-for-byte the way a made-up id is.
 * Anything that differs between the two is a way to learn which ids are real.
 */

/**
 * What a leaked server error looks like in rendered text: a V8 stack frame, a
 * source position, a dependency path, an error's own name.
 */
const STACK_TEXT = [
  /\bat \S+ \(/,
  /\.(?:[cm]?js|tsx?):\d+/,
  /node_modules/,
  /\b\w*Error:/,
  /Failed query/,
] as const;

/**
 * Everything a reader of the response could compare — once it is established
 * that the response is a signed-in 404. Without that, two redirects to
 * `/login` from a dead session would compare equal too, and the test below
 * would pass while asking nothing. The status cannot be that check:
 * `/recipes/[id]/loading.tsx` makes the route stream, so a 404 there is
 * answered `200` with a `noindex` tag.
 */
async function answer(page: Page, path: string) {
  const response = await page.goto(path);
  if (response === null) throw new Error(`No response for ${path}`);

  await expect(page.getByRole("banner")).toContainText(E2E_HOUSEHOLD_NAME);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");

  return {
    status: response.status(),
    title: await page.title(),
    main: await page.getByRole("main").innerHTML(),
    served: await response.text(),
  };
}

test("renders the styled 404 inside the shell for a recipe that does not exist", async ({
  page,
}) => {
  await page.goto(`/recipes/${randomUUID()}`);

  // Inside the shell: the signed-in header, not a bare framework page.
  const banner = page.getByRole("banner");
  await expect(banner).toContainText(E2E_HOUSEHOLD_NAME);
  await expect(banner.getByRole("navigation", { name: "Primary" })).toBeVisible();

  // The app's own 404 rather than Next's default, whose heading is "404".
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
  const back = page.getByRole("main").getByRole("link", { name: "Back to recipes" });
  await expect(back).toHaveAttribute("href", "/recipes");

  // Styled: the compiled stylesheet arrived and painted the body. Unstyled, a
  // body's background is transparent.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
    "rgba(0, 0, 0, 0)",
  );

  const text = await page.locator("body").innerText();
  for (const pattern of STACK_TEXT) expect(text).not.toMatch(pattern);
});

test("answers a recipe in another household exactly as it answers one that does not exist", async ({
  page,
}) => {
  const missing = await answer(page, `/recipes/${randomUUID()}`);
  const foreign = await answer(page, `/recipes/${foreignRecipeId()}`);

  // Status, title and rendered content alike. A 403 here, or a "you do not
  // have access" in the copy, would confirm the id is real.
  expect(foreign.status).toBe(missing.status);
  expect(foreign.title).toBe(missing.title);
  expect(foreign.main).toBe(missing.main);

  // And nothing of the other household made it into the response — checked on
  // the served bytes, which include the RSC payload and the shell, and not only
  // on what `<main>` renders. None of these contains a character HTML escapes,
  // so a leak would arrive spelled exactly as written here.
  for (const value of [
    FOREIGN_RECIPE_NAME,
    FOREIGN_INGREDIENT_NAME,
    E2E_FOREIGN_HOUSEHOLD_NAME,
    E2E_FOREIGN_EMAIL,
  ]) {
    expect(foreign.served).not.toContain(value);
  }
});
