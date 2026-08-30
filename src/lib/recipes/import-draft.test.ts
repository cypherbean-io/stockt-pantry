import { describe, expect, it } from "vitest";

import type { ParsedRecipe } from "@/lib/import/jsonld";

import {
  DEFAULT_SERVINGS,
  buildImportDraft,
  servingsFromYield,
  suggestIngredient,
} from "./import-draft";
import { MAX_LINES, MAX_STEPS } from "./form";

/**
 * The step between "we parsed a page" and "a human confirms it" (SPEC.md §3
 * step 4). Pure, so the review screen's whole behaviour is testable without a
 * network or a database — which matters because this is the layer that decides
 * what a user is shown and asked to agree to.
 */

function recipe(overrides: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    name: "Chocolate chip cookies",
    ingredientLines: ["300 g all-purpose flour", "225 g butter"],
    steps: ["Cream the butter", "Fold in the flour"],
    recipeYield: "24 cookies",
    ...overrides,
  };
}

describe("suggestIngredient", () => {
  it("matches a catalog entry that differs only in case and punctuation", () => {
    expect(suggestIngredient("all purpose flour", ["All-purpose flour"])).toBe("All-purpose flour");
  });

  it("suggests the catalog's shorter name when the parsed line adds qualifiers", () => {
    expect(suggestIngredient("all-purpose flour", ["Flour"])).toBe("Flour");
  });

  it("suggests the catalog's longer name when the parsed line is the bare noun", () => {
    expect(suggestIngredient("flour", ["All-purpose flour"])).toBe("All-purpose flour");
  });

  it("matches a plural on the page against a singular in the catalog", () => {
    expect(suggestIngredient("large eggs", ["Egg"])).toBe("Egg");
  });

  it("prefers the exact name over one that merely contains it", () => {
    expect(suggestIngredient("flour", ["All-purpose flour", "Flour"])).toBe("Flour");
  });

  it("suggests nothing when no catalog entry shares the head of the name", () => {
    // "peanut oil" and "peanut butter" share a word but are not the same thing,
    // and a wrong suggestion is worse than none on a screen people click through.
    expect(suggestIngredient("peanut oil", ["Peanut butter", "Sugar"])).toBeUndefined();
  });

  it("suggests nothing against an empty catalog", () => {
    expect(suggestIngredient("flour", [])).toBeUndefined();
  });
});

describe("servingsFromYield", () => {
  it.each([
    ["4", 4],
    ["4 servings", 4],
    ["Serves 6", 6],
    ["Makes 24 cookies", 24],
    ["Makes about 12 muffins", 12],
    ["4-6 servings", 4],
  ])("reads %s as %i servings", (raw, expected) => {
    expect(servingsFromYield(raw)).toBe(expected);
  });

  it("reads nothing from a yield with no number in it", () => {
    expect(servingsFromYield("a dozen")).toBeNull();
  });

  it("reads nothing from a page that stated no yield", () => {
    expect(servingsFromYield(null)).toBeNull();
  });

  it.each([["0"], ["1000 servings"]])("rejects %s, which the recipe form would not accept", (raw) => {
    expect(servingsFromYield(raw)).toBeNull();
  });
});

describe("buildImportDraft", () => {
  it("turns each parsed line into a review row in the page's order", () => {
    const result = buildImportDraft(recipe(), "https://example.com/cookies", []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.lines).toEqual([
      {
        raw: "300 g all-purpose flour",
        name: "all-purpose flour",
        quantity: "300",
        unitId: "g",
        confidence: "high",
        fromCatalog: false,
      },
      {
        raw: "225 g butter",
        name: "butter",
        quantity: "225",
        unitId: "g",
        confidence: "high",
        fromCatalog: false,
      },
    ]);
  });

  it("carries the recipe name, steps and source URL into the draft", () => {
    const result = buildImportDraft(recipe(), "https://example.com/cookies", []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.name).toBe("Chocolate chip cookies");
    expect(result.draft.steps).toBe("Cream the butter\nFold in the flour");
    expect(result.draft.sourceUrl).toBe("https://example.com/cookies");
  });

  it("prefills a line with the household's own catalog name when one matches", () => {
    const result = buildImportDraft(recipe(), "https://example.com/cookies", ["Flour", "Butter"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.lines[0]?.name).toBe("Flour");
    expect(result.draft.lines[0]?.fromCatalog).toBe(true);
  });

  it("does not hand the same catalog entry to two lines", () => {
    // Both lines are a kind of flour. Suggesting "Flour" for each would produce
    // a recipe the save path rejects as a duplicate ingredient, and the second
    // line's own text is the better starting point anyway.
    const result = buildImportDraft(
      recipe({ ingredientLines: ["300 g all-purpose flour", "50 g bread flour"] }),
      "https://example.com/cookies",
      ["Flour"],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.lines[0]?.name).toBe("Flour");
    expect(result.draft.lines[1]?.name).toBe("bread flour");
    expect(result.draft.lines[1]?.fromCatalog).toBe(false);
  });

  it("leaves an unreadable line with no quantity and no unit chosen", () => {
    // SPEC.md §5: an ambiguous line must reach the user as something they have
    // to fill in, never as a plausible-looking default they scroll past.
    const result = buildImportDraft(
      recipe({ ingredientLines: ["a pinch of salt"] }),
      "https://example.com/cookies",
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.lines[0]).toMatchObject({
      raw: "a pinch of salt",
      quantity: "",
      unitId: "",
      confidence: "low",
    });
  });

  it("rounds a fractional quantity to something a kitchen can read", () => {
    const result = buildImportDraft(
      recipe({ ingredientLines: ["1/3 cup milk"] }),
      "https://example.com/cookies",
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.lines[0]?.quantity).toBe("0.3333");
    expect(result.draft.lines[0]?.unitId).toBe("cup");
  });

  it("takes the serving count from the page's yield", () => {
    const result = buildImportDraft(recipe(), "https://example.com/cookies", []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.baseServings).toBe("24");
    expect(result.draft.servingsStated).toBe(true);
  });

  it("flags the serving count as this app's own guess when the page stated none", () => {
    const result = buildImportDraft(
      recipe({ recipeYield: null }),
      "https://example.com/cookies",
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.baseServings).toBe(String(DEFAULT_SERVINGS));
    expect(result.draft.servingsStated).toBe(false);
  });

  it("refuses a recipe with more ingredient lines than the form can save", () => {
    const result = buildImportDraft(
      recipe({ ingredientLines: Array.from({ length: MAX_LINES + 1 }, (_, i) => `${i + 1} g salt`) }),
      "https://example.com/cookies",
      [],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/ingredient/i);
  });

  it("refuses a recipe with more steps than the form can save", () => {
    const result = buildImportDraft(
      recipe({ steps: Array.from({ length: MAX_STEPS + 1 }, (_, i) => `Step ${i + 1}`) }),
      "https://example.com/cookies",
      [],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/step/i);
  });

  it("keeps an over-long name rather than truncating it, leaving the user to shorten it", () => {
    const long = "x".repeat(500);
    const result = buildImportDraft(
      recipe({ name: long }),
      "https://example.com/cookies",
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe(long);
  });
});

describe("buildImportDraft, cost", () => {
  it("matches a full recipe against a large catalog without blocking the server", { timeout: 1_000 }, () => {
    /**
     * The adversarial shape: every catalog entry shares its head token with
     * every parsed line, so nothing can be skipped on a cheap comparison.
     *
     * The catalog was tokenised once per *line* rather than once, and the
     * parsed line's token set was rebuilt once per catalog *entry* — so the
     * work was lines x catalog x tokens on the request thread of a
     * single-threaded server, with no rate limit in front of it. A household
     * grows its own catalog one confirmed import at a time and v1 has no way
     * to delete an entry, so the catalog side of that product is reachable.
     * The timeout is the assertion.
     */
    const catalog = Array.from({ length: 20_000 }, (_unused, index) => `variety${index} flour`);
    const lines = Array.from({ length: MAX_LINES }, (_unused, index) => `${index + 1} g fine flour`);

    const result = buildImportDraft(recipe({ ingredientLines: lines }), "https://example.com/x", catalog);

    expect(result.ok).toBe(true);
  });
});
