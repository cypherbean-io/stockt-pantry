import { describe, expect, it } from "vitest";

import {
  MAX_DENSITY,
  MAX_LINES,
  MAX_SERVINGS,
  MAX_URL_LENGTH,
  MIN_DENSITY,
  parseRecipeForm,
  parseServings,
} from "./form";

/**
 * A server action is a public POST endpoint, so this parser is the boundary
 * between "whatever was submitted" and the query layer. Everything it accepts
 * has to survive `assertPositiveQuantity` and the CHECK constraints behind it —
 * the tests below are the list of things that must not get that far.
 */

function form(fields: Readonly<Record<string, string | readonly string[]>>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value as string]) {
      data.append(key, item);
    }
  }
  return data;
}

function complete(overrides: Readonly<Record<string, string | readonly string[]>> = {}): FormData {
  return form({
    name: "Chocolate chip cookies",
    baseServings: "24",
    steps: "Cream the butter\nFold in the flour",
    ingredientName: ["Flour", "Butter"],
    ingredientQuantity: ["300", "225"],
    ingredientUnit: ["g", "g"],
    ingredientDensity: ["0.53", ""],
    ...overrides,
  });
}

function errorFor(data: FormData, field: string): string | undefined {
  const parsed = parseRecipeForm(data);
  return parsed.ok ? undefined : parsed.fieldErrors[field];
}

describe("parseRecipeForm", () => {
  it("accepts a filled-in form", () => {
    const parsed = parseRecipeForm(complete());

    expect(parsed.ok && parsed.value).toEqual({
      name: "Chocolate chip cookies",
      baseServings: 24,
      steps: ["Cream the butter", "Fold in the flour"],
      lines: [
        { name: "Flour", quantity: 300, unitId: "g", densityGPerMl: 0.53 },
        { name: "Butter", quantity: 225, unitId: "g" },
      ],
    });
  });

  it("trims the recipe name", () => {
    const parsed = parseRecipeForm(complete({ name: "  Soda bread  " }));

    expect(parsed.ok && parsed.value.name).toBe("Soda bread");
  });

  it("rejects a name that is only whitespace", () => {
    expect(errorFor(complete({ name: "   " }), "name")).toMatch(/name/i);
  });

  it("rejects a name longer than the column is meant to hold", () => {
    expect(errorFor(complete({ name: "x".repeat(201) }), "name")).toMatch(/long/i);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-4"],
    ["fractional", "2.5"],
    ["not a number", "lots"],
    ["blank", ""],
  ])("rejects %s base servings", (_label, value) => {
    expect(errorFor(complete({ baseServings: value }), "baseServings")).toMatch(/servings/i);
  });

  it("drops blank lines between steps", () => {
    const parsed = parseRecipeForm(complete({ steps: "Mix\n\n  \nBake\n" }));

    expect(parsed.ok && parsed.value.steps).toEqual(["Mix", "Bake"]);
  });

  it("accepts a recipe with no steps at all", () => {
    const parsed = parseRecipeForm(complete({ steps: "" }));

    expect(parsed.ok && parsed.value.steps).toEqual([]);
  });

  it("requires at least one ingredient line", () => {
    const parsed = parseRecipeForm(
      complete({
        ingredientName: [],
        ingredientQuantity: [],
        ingredientUnit: [],
        ingredientDensity: [],
      }),
    );

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.fieldErrors["lines"]).toMatch(/ingredient/i);
  });

  it("rejects a submission whose line columns do not line up", () => {
    // The four repeated inputs are index-aligned by DOM order. A hand-rolled
    // POST can break that, and pairing a name with the next row's quantity
    // would silently save the wrong recipe.
    const parsed = parseRecipeForm(complete({ ingredientQuantity: ["300"] }));

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.fieldErrors["lines"]).toMatch(/ingredient/i);
  });

  it("rejects more lines than a recipe is allowed", () => {
    const many = Array.from({ length: MAX_LINES + 1 }, (_unused, index) => `Ingredient ${index}`);
    const parsed = parseRecipeForm(
      complete({
        ingredientName: many,
        ingredientQuantity: many.map(() => "1"),
        ingredientUnit: many.map(() => "g"),
        ingredientDensity: many.map(() => ""),
      }),
    );

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.fieldErrors["lines"]).toMatch(/too many/i);
  });

  it("rejects a blank ingredient name", () => {
    expect(errorFor(complete({ ingredientName: ["Flour", "  "] }), "line-1")).toMatch(/name/i);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["not a number", "some"],
    ["blank", ""],
    ["infinite", "Infinity"],
  ])("rejects a %s quantity", (_label, value) => {
    // CLAUDE.md: these are rejected at the data-entry layer, because the
    // matching engine assumes valid input. An Infinity here would make a recipe
    // report makeable off an empty pantry.
    expect(errorFor(complete({ ingredientQuantity: ["300", value] }), "line-1")).toMatch(
      /quantity/i,
    );
  });

  it("rejects a unit the conversion table does not know", () => {
    expect(errorFor(complete({ ingredientUnit: ["g", "furlong"] }), "line-1")).toMatch(/unit/i);
  });

  it("treats a blank density as absent rather than zero", () => {
    const parsed = parseRecipeForm(complete({ ingredientDensity: ["", ""] }));

    expect(parsed.ok && parsed.value.lines[0]).toEqual({
      name: "Flour",
      quantity: 300,
      unitId: "g",
    });
  });

  it.each([
    ["zero", "0"],
    ["negative", "-0.5"],
    ["not a number", "heavy"],
    ["infinite", "Infinity"],
  ])("rejects a %s density", (_label, value) => {
    expect(errorFor(complete({ ingredientDensity: [value, ""] }), "line-0")).toMatch(/density/i);
  });

  it.each([
    ["lighter than any substance", String(MIN_DENSITY / 10)],
    ["heavier than any substance", String(MAX_DENSITY * 10)],
  ])("rejects a density %s", (_label, value) => {
    // `> 0` is not enough here. A density of 1e-300 passes both that and the
    // CHECK constraint, then divides a pantry quantity into Infinity inside
    // `convert` — and Infinity satisfies "have enough" for every recipe.
    expect(errorFor(complete({ ingredientDensity: [value, ""] }), "line-0")).toMatch(/density/i);
  });

  it("accepts a density at each end of the physical range", () => {
    expect(
      parseRecipeForm(complete({ ingredientDensity: [String(MIN_DENSITY), String(MAX_DENSITY)] })).ok,
    ).toBe(true);
  });

  it("rejects a recipe name carrying a control character", () => {
    expect(errorFor(complete({ name: "Cookies\u0000" }), "name")).toMatch(/name/i);
  });

  it("rejects an ingredient name carrying a control character", () => {
    // Postgres rejects a NUL byte in text outright (SQLSTATE 22021), and by the
    // time it does, the catalog rows for the *other* lines have already been
    // committed — so this has to be caught before any of them are written.
    expect(errorFor(complete({ ingredientName: ["Flour", "Butter\u0000"] }), "line-1")).toMatch(
      /name/i,
    );
  });

  it("rejects a step carrying a control character", () => {
    expect(errorFor(complete({ steps: "Mix\nBake\u0007" }), "steps")).toMatch(/steps?/i);
  });

  it("still accepts a tab inside a step", () => {
    const parsed = parseRecipeForm(complete({ steps: "Mix\twell" }));

    expect(parsed.ok && parsed.value.steps).toEqual(["Mix\twell"]);
  });

  it("rejects two lines naming the same ingredient, ignoring case", () => {
    // One pantry/recipe row per ingredient is a unique constraint; catching it
    // here turns a SQLSTATE 23505 into something the form can point at.
    expect(errorFor(complete({ ingredientName: ["Flour", "flour"] }), "line-1")).toMatch(
      /twice|already/i,
    );
  });
});

describe("parseServings", () => {
  it("falls back to the recipe's own serving count when nothing is asked for", () => {
    expect(parseServings(undefined, 4)).toBe(4);
    expect(parseServings("", 4)).toBe(4);
  });

  it("uses the requested count when it is a whole number above zero", () => {
    expect(parseServings("12", 4)).toBe(12);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-8"],
    ["fractional", "4.5"],
    ["not a number", "lots"],
    ["infinite", "Infinity"],
    ["beyond the cap", String(MAX_SERVINGS + 1)],
  ])("ignores a %s serving count and keeps the recipe's own", (_label, value) => {
    // A bad `?servings=` is a URL someone typed, not an error worth a 500 —
    // but it must not reach the engine and scale every quantity by NaN.
    expect(parseServings(value, 4)).toBe(4);
  });
});

describe("parseRecipeForm, source URL", () => {
  /**
   * An imported recipe records the page it came from (SPEC.md §3). The review
   * screen posts it back as a hidden field, so by the time it reaches here it is
   * request input like any other — the fetch that produced it is long over and
   * cannot vouch for what was submitted.
   */

  it("keeps the page a recipe was imported from", () => {
    const parsed = parseRecipeForm(complete({ sourceUrl: "https://example.com/cookies" }));

    expect(parsed.ok && parsed.value.sourceUrl).toBe("https://example.com/cookies");
  });

  it.each([
    ["a form with no source field at all", {}],
    ["a source field left blank", { sourceUrl: "  " }],
  ])("records no source for %s", (_label, overrides) => {
    const parsed = parseRecipeForm(complete(overrides));

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && "sourceUrl" in parsed.value).toBe(false);
  });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a file: URL", "file:///etc/passwd"],
    ["something that is not a URL at all", "not a url"],
  ])("rejects %s as a source", (_label, value) => {
    // Only ever rendered as text, never as a link — but a stored `javascript:`
    // URL is one careless `<a href>` away from being live, and nothing that
    // reaches here was fetched through the http/https guard.
    expect(errorFor(complete({ sourceUrl: value }), "sourceUrl")).toBeDefined();
  });

  it("rejects a source URL longer than a browser would follow", () => {
    expect(
      errorFor(complete({ sourceUrl: `https://example.com/${"x".repeat(MAX_URL_LENGTH)}` }), "sourceUrl"),
    ).toBeDefined();
  });

  it("rejects a source URL that only exceeds the cap once it is normalised", () => {
    // Under the cap as submitted, over it as stored: `new URL` percent-encodes
    // each non-ASCII character to six, and `href` is what gets written.
    const submitted = `https://example.com/${"\u00e9".repeat(MAX_URL_LENGTH - 100)}`;

    expect(submitted.length).toBeLessThan(MAX_URL_LENGTH);
    expect(errorFor(complete({ sourceUrl: submitted }), "sourceUrl")).toBeDefined();
  });
});
