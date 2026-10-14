import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addPantryItem, addRecipe } from "./seed";
import { E2E_BASE_URL, E2E_STORAGE_STATE } from "./server";

/**
 * The app on a phone (SPEC.md §5 Smoke 4, §2 item 9).
 *
 * `screens.test.tsx` already checks, per screen and without a browser, that
 * every control carries the tap-size classes and every table its card layout.
 * What it cannot check is the result: a class that compiles but loses to
 * another, a long name that pushes a card past the edge, a viewport meta tag
 * that went missing. Those only show up as measured boxes in a laid-out page.
 *
 * `isMobile` makes Chromium honour the viewport meta tag and use overlay
 * scrollbars, as a phone does; `hasTouch` is what lets the menu be tapped.
 */

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const PHONE_WIDTH = 375;

/** WCAG 2.2 SC 2.5.5, and SPEC.md §2 item 9: 44×44 CSS px. */
const MIN_TARGET = 44;

const NAV_LABELS = ["Recipes", "Pantry", "Household"] as const;

let recipeId: string;

/**
 * A pantry and a recipe that put all four line statuses and a two-line
 * shopping list on `/recipes/[id]`, so the stacked-card layouts are measured
 * with something in them. The names are realistically long — the overflow
 * checks want that — and suffixed so that two workers seeding the shared
 * household at once do not collide.
 *
 * Plus one recipe with a short name, for the target checks. A long name wraps
 * onto two lines and makes its link 48px tall whatever its classes say, which
 * is how a dropped `min-h-tap` on the recipe link went unnoticed until this
 * was added. A one-line name is the case the minimum actually has to hold for.
 *
 * `beforeAll` runs once per worker that picks up a test from this file; each
 * worker seeds its own copy, which costs a few rows and nothing else.
 */
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    storageState: E2E_STORAGE_STATE,
  });

  try {
    const page = await context.newPage();
    const tag = randomUUID().slice(0, 8);

    await addPantryItem(page, {
      ingredient: `Tinned chickpeas ${tag}`,
      quantity: "400",
      unit: "g",
    });
    await addPantryItem(page, { ingredient: `Brown onions ${tag}`, quantity: "1", unit: "count" });
    // No density, against a recipe line in grams: "can't verify".
    await addPantryItem(page, {
      ingredient: `Extra virgin olive oil ${tag}`,
      quantity: "100",
      unit: "ml",
    });

    recipeId = await addRecipe(page, {
      name: `Chana masala with charred tomatoes ${tag}`,
      lines: [
        { ingredient: `Tinned chickpeas ${tag}`, quantity: "240", unit: "g" }, // have
        { ingredient: `Brown onions ${tag}`, quantity: "2", unit: "count" }, // short
        { ingredient: `Chopped tomatoes ${tag}`, quantity: "400", unit: "g" }, // missing
        { ingredient: `Extra virgin olive oil ${tag}`, quantity: "30", unit: "g" }, // unresolved
      ],
    });

    await addRecipe(page, {
      name: `Dal ${tag}`,
      lines: [{ ingredient: `Red lentils ${tag}`, quantity: "200", unit: "g" }],
    });
  } finally {
    await context.close();
  }
});

/**
 * Every rendered control smaller than `MIN_TARGET` in either dimension, as a
 * readable line — so a failure names the control rather than a count.
 *
 * Unrendered ones (`display: none`, inside a closed disclosure) have an empty
 * box and are skipped: they are not targets until they are shown, and the
 * tests that open them measure them then.
 */
function undersizedTargets(page: Page): Promise<string[]> {
  return page.evaluate((minimum) => {
    const interactive =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
      '[role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

    return [...document.querySelectorAll<HTMLElement>(interactive)].flatMap((element) => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return [];
      if (getComputedStyle(element).visibility === "hidden") return [];
      if (box.width >= minimum && box.height >= minimum) return [];

      const name = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
      const size = `${box.width.toFixed(1)}×${box.height.toFixed(1)}`;
      return [`<${element.tagName.toLowerCase()}> "${name.slice(0, 40)}" is ${size}`];
    });
  }, MIN_TARGET);
}

/**
 * `clientWidth`, not `window.innerWidth` as SPEC.md §5 words it. On a phone a
 * page wider than the screen can be zoomed out to fit, which widens the visual
 * viewport `innerWidth` reports until it matches the overflow and the check
 * passes. `clientWidth` is the layout viewport, which does not move.
 */
function widths(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test("collapses the navigation behind a Menu button that Escape closes", async ({ page }) => {
  await page.goto("/recipes");

  const nav = page.getByRole("navigation", { name: "Primary" });
  const menu = nav.getByRole("button", { name: "Menu" });
  // `includeHidden`, so "hidden" is asserted of links that exist — a nav that
  // stopped rendering them at all would otherwise pass as collapsed.
  const link = (name: string) => nav.getByRole("link", { name, includeHidden: true });

  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  for (const name of NAV_LABELS) {
    await expect(link(name)).toHaveCount(1);
    await expect(link(name)).toBeHidden();
  }

  await menu.tap();

  await expect(menu).toHaveAttribute("aria-expanded", "true");
  for (const name of NAV_LABELS) await expect(link(name)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(menu).toHaveAttribute("aria-expanded", "false");
  for (const name of NAV_LABELS) await expect(link(name)).toBeHidden();
  // Back where it came from, so the next Tab does not restart at the top.
  await expect(menu).toBeFocused();
});

test("keeps what the header disclosures reveal tap-sized", async ({ page }) => {
  await page.goto("/recipes");

  await page.getByRole("button", { name: "Menu" }).tap();
  expect(await undersizedTargets(page), "with the navigation open").toEqual([]);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Account" }).tap();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(await undersizedTargets(page), "with the account menu open").toEqual([]);
});

const ROUTES = [
  { name: "/recipes", path: () => "/recipes" },
  { name: "/pantry", path: () => "/pantry" },
  // A function, because the id only exists once `beforeAll` has run.
  { name: "/recipes/[id]", path: () => `/recipes/${recipeId}` },
] as const;

for (const route of ROUTES) {
  test(`fits ${route.name} on a ${PHONE_WIDTH}px screen with no sideways scroll`, async ({
    page,
  }) => {
    await page.goto(route.path());
    // Sanity: the page laid out at the phone's width. Without a viewport meta
    // tag a mobile browser lays out at 980px, and everything would "fit".
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const { scrollWidth, clientWidth } = await widths(page);
    expect(clientWidth).toBe(PHONE_WIDTH);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`makes every target on ${route.name} at least ${MIN_TARGET}×${MIN_TARGET}`, async ({
    page,
  }) => {
    await page.goto(route.path());
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    expect(await undersizedTargets(page)).toEqual([]);
  });
}
