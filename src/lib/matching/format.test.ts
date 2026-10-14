import { describe, expect, it } from "vitest";

import { round, shoppingListText } from "./format";
import { matchRecipe, shoppingList } from "./match";
import type { Ingredient, PantryItem, Recipe } from "./types";
import { UNITS } from "./units";

/**
 * The shopping list as plain text, for the Copy button (SPEC.md §3.8).
 *
 * The lines come from the real engine rather than being written out, so what
 * is tested is the text of a list the page would actually show.
 */

const CHICKPEAS: Ingredient = { id: "chickpeas", name: "Chickpeas" };
const TOMATOES: Ingredient = { id: "tomatoes", name: "Tomatoes" };
const MILK: Ingredient = { id: "milk", name: "Milk" };

const CHANA_MASALA: Recipe = {
  name: "Chana masala",
  baseServings: 4,
  ingredients: [
    { ingredient: CHICKPEAS, quantity: { value: 240, unit: UNITS.g } },
    { ingredient: TOMATOES, quantity: { value: 400, unit: UNITS.g } },
  ],
};

function textFor(recipe: Recipe, servings: number, pantry: readonly PantryItem[] = []): string {
  const result = matchRecipe(recipe, pantry, servings);
  return shoppingListText(recipe.name, servings, shoppingList(result));
}

describe("round", () => {
  it("drops the float noise a unit conversion leaves behind", () => {
    expect(round(402.19999999999993)).toBe("402.2");
  });

  it("writes a whole number without a decimal point", () => {
    expect(round(240)).toBe("240");
  });
});

describe("shoppingListText", () => {
  it("is exactly the block SPEC.md §3.8 shows", () => {
    expect(textFor(CHANA_MASALA, 4)).toBe(
      "Chana masala — shopping list (4 servings)\n- Chickpeas: 240 g\n- Tomatoes: 400 g",
    );
  });

  it("lists the shortfall, not the whole amount the recipe needs", () => {
    // 100 g of tomatoes held against 400 g needed: buy 300, not 400.
    const text = textFor(CHANA_MASALA, 4, [
      { ingredient: TOMATOES, quantity: { value: 100, unit: UNITS.g } },
    ]);

    expect(text).toContain("- Tomatoes: 300 g");
  });

  it("leaves out what the pantry already covers", () => {
    const text = textFor(CHANA_MASALA, 4, [
      { ingredient: CHICKPEAS, quantity: { value: 1, unit: UNITS.kg } },
    ]);

    expect(text).not.toContain("Chickpeas");
    expect(text.split("\n")).toHaveLength(2);
  });

  it("states the servings the list was worked out for", () => {
    expect(textFor(CHANA_MASALA, 6).split("\n")[0]).toBe(
      "Chana masala — shopping list (6 servings)",
    );
  });

  it("says one serving, not one servings", () => {
    expect(textFor(CHANA_MASALA, 1).split("\n")[0]).toBe(
      "Chana masala — shopping list (1 serving)",
    );
  });

  it("rounds the amounts the way the page does", () => {
    // A cup for three, rescaled to two, is two thirds of a cup — a repeating
    // decimal nobody wants on a list.
    const recipe: Recipe = {
      name: "Pancakes",
      baseServings: 3,
      ingredients: [{ ingredient: MILK, quantity: { value: 1, unit: UNITS.cup } }],
    };

    expect(textFor(recipe, 2)).toBe("Pancakes — shopping list (2 servings)\n- Milk: 0.67 cup");
  });

  it("writes units by their display name", () => {
    const recipe: Recipe = {
      name: "Porridge",
      baseServings: 1,
      ingredients: [{ ingredient: MILK, quantity: { value: 250, unit: UNITS.ml } }],
    };

    expect(textFor(recipe, 1)).toContain("- Milk: 250 mL");
  });

  it("is plain text, so nothing in a name is escaped", () => {
    // It goes onto the clipboard, not into HTML: `&amp;` in a pasted list
    // would be a bug, not a safety measure.
    const recipe: Recipe = {
      name: "Mac & cheese <best>",
      baseServings: 2,
      ingredients: [
        { ingredient: { id: "cheddar", name: "Cheddar \"mature\"" }, quantity: { value: 200, unit: UNITS.g } },
      ],
    };

    expect(textFor(recipe, 2)).toBe(
      'Mac & cheese <best> — shopping list (2 servings)\n- Cheddar "mature": 200 g',
    );
  });

  it.each([
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
    ["next line", "\u0085"],
    ["line feed", "\n"],
  ])("lets no name start a line of its own with a %s", (_name, breaker) => {
    // The entry forms' control-character check predates this and misses the
    // Unicode line breaks, and an imported recipe's names are a third-party
    // page's words. A pasted list must have exactly the lines the page shows.
    const recipe: Recipe = {
      name: `Curry${breaker}- Fake header`,
      baseServings: 1,
      ingredients: [
        { ingredient: { id: "x", name: `Chickpeas${breaker}- Bleach: 2 L` }, quantity: { value: 1, unit: UNITS.g } },
      ],
    };

    const text = textFor(recipe, 1);

    expect(text.split(/\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/)).toHaveLength(2);
    expect(text).toBe("Curry - Fake header — shopping list (1 serving)\n- Chickpeas - Bleach: 2 L: 1 g");
  });

  it("drops the invisible characters that reorder or hide text", () => {
    // A right-to-left override or a zero-width space in a pasted list shows
    // the reader something other than the characters that are there.
    const recipe: Recipe = {
      name: "Dal",
      baseServings: 1,
      ingredients: [
        { ingredient: { id: "x", name: "Lent\u200Bils\u202E" }, quantity: { value: 1, unit: UNITS.g } },
      ],
    };

    expect(textFor(recipe, 1)).toBe("Dal — shopping list (1 serving)\n- Lentils: 1 g");
  });
});
