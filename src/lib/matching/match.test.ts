import { describe, expect, it } from "vitest";

import { PANTRY, RECIPE } from "@/lib/fixtures";
import { matchRecipe, shoppingList } from "./match";
import type { LineStatus } from "./types";

function statuses(result: ReturnType<typeof matchRecipe>): Record<string, LineStatus> {
  return Object.fromEntries(
    result.lines.map((line) => [line.ingredient.id, line.status]),
  );
}

describe("matchRecipe", () => {
  it("classifies every line of the seeded recipe against the seeded pantry", () => {
    const result = matchRecipe(RECIPE, PANTRY);

    expect(statuses(result)).toEqual({
      // 500 g on hand, 300 g needed.
      flour: "have",
      // 2 cup on hand converts through density (0.85 g/mL) to ~402 g, 200 g needed.
      sugar: "have",
      // 3 on hand, 2 needed.
      egg: "have",
      // Not in the pantry at all.
      butter: "missing",
      // 100 g on hand, 200 g needed.
      "choc-chips": "short",
      // Pantry holds grams, recipe wants tsp, and vanilla has no density.
      vanilla: "unresolved",
    });
    expect(result.makeable).toBe(false);
  });

  it("scales required quantities with the target serving count", () => {
    const doubled = matchRecipe(RECIPE, PANTRY, RECIPE.baseServings * 2);
    const flour = doubled.lines.find((line) => line.ingredient.id === "flour");

    // 300 g at 24 servings becomes 600 g at 48 — more than the 500 g on hand.
    expect(flour?.required.value).toBe(600);
    expect(flour?.status).toBe("short");
    expect(flour?.shortfall).toBe(100);
  });
});

describe("shoppingList", () => {
  it("lists only missing and short lines, with shortfalls in the recipe's unit", () => {
    const list = shoppingList(matchRecipe(RECIPE, PANTRY));

    expect(
      list.map((line) => ({
        id: line.ingredient.id,
        shortfall: line.shortfall,
        unit: line.required.unit.name,
      })),
    ).toEqual([
      { id: "butter", shortfall: 225, unit: "g" },
      { id: "choc-chips", shortfall: 100, unit: "g" },
    ]);
  });

  it("omits unresolved lines, which buying nothing can fix", () => {
    const list = shoppingList(matchRecipe(RECIPE, PANTRY));

    expect(list.map((line) => line.ingredient.id)).not.toContain("vanilla");
  });
});
