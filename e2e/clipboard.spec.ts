import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addRecipe } from "./seed";
import { E2E_BASE_URL, E2E_STORAGE_STATE } from "./server";

/**
 * Copy to clipboard on the shopping list (SPEC.md §3.8, §5 Smoke 7).
 *
 * `copy-button.test.tsx` already runs every branch of the decision in Node.
 * What it cannot show is a real browser: that the click reaches the system
 * clipboard with the right bytes, and that a browser with no
 * `navigator.clipboard` — which is every plain-HTTP LAN deployment — gets the
 * text box rather than an exception.
 *
 * The expected text is written out rather than built with
 * `shoppingListText`, for the reason `buckets.spec.ts` gives: an expectation
 * derived from the code under test cannot catch that code being wrong.
 */

let recipeId = "";
let expected = "";

/**
 * Two lines with nothing in the pantry for either, so both are missing and
 * the list is the whole recipe. The recipe form defaults to 4 servings.
 */
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    storageState: E2E_STORAGE_STATE,
  });

  try {
    const page = await context.newPage();
    const tag = randomUUID().slice(0, 8);
    const name = `Chana masala ${tag}`;

    recipeId = await addRecipe(page, {
      name,
      lines: [
        { ingredient: `Chickpeas ${tag}`, quantity: "240", unit: "g" },
        { ingredient: `Passata ${tag}`, quantity: "400", unit: "ml" },
      ],
    });

    expected = [
      `${name} — shopping list (4 servings)`,
      `- Chickpeas ${tag}: 240 g`,
      `- Passata ${tag}: 400 mL`,
    ].join("\n");
  } finally {
    await context.close();
  }
});

/** Every uncaught exception on the page — "nothing throws" is half of Smoke 7. */
function uncaught(page: Page): readonly Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  return errors;
}

async function copy(page: Page): Promise<void> {
  await page.goto(`/recipes/${recipeId}`);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
}

/** The fallback is on screen, holds the list, and has it all selected. */
async function expectFallback(page: Page): Promise<void> {
  const box = page.getByRole("textbox", { name: "Select all and copy" });

  await expect(box).toHaveValue(expected);
  await expect(box).toHaveAttribute("readonly", "");
  await expect(box).toBeFocused();
  expect(
    await box.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, expected.length]);
}

test("puts the shopping list on the clipboard as plain text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = uncaught(page);

  await copy(page);

  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveText(
    "Copied to the clipboard.",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  await expect(page.getByRole("textbox", { name: "Select all and copy" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("falls back to a selected text box where there is no clipboard", async ({ page }) => {
  // What a plain-HTTP origin looks like: the property is not there at all.
  await page.addInitScript(() => {
    delete (Navigator.prototype as { clipboard?: unknown }).clipboard;
  });
  const errors = uncaught(page);

  await copy(page);

  expect(await page.evaluate(() => "clipboard" in navigator)).toBe(false);
  await expectFallback(page);
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("falls back when the browser refuses the write", async ({ page }) => {
  // A secure context whose clipboard says no — permission denied, or focus
  // lost between the click and the write.
  await page.addInitScript(() => {
    Clipboard.prototype.writeText = () =>
      Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
  });
  const errors = uncaught(page);

  await copy(page);

  await expectFallback(page);
  expect(errors).toEqual([]);
});
