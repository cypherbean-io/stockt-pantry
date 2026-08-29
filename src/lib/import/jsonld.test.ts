import { describe, expect, it } from "vitest";

import { extractRecipe } from "./jsonld";

/** Wraps a JSON-LD payload in the smallest page that could carry it. */
function page(jsonLd: unknown, attrs = 'type="application/ld+json"') {
  return `<!doctype html><html><head><script ${attrs}>${
    typeof jsonLd === "string" ? jsonLd : JSON.stringify(jsonLd)
  }</script></head><body><h1>ignored</h1></body></html>`;
}

const COOKIES = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Chocolate Chip Cookies",
  recipeYield: "24 cookies",
  recipeIngredient: ["300 g all-purpose flour", "2 large eggs"],
  recipeInstructions: ["Mix the dry ingredients.", "Bake for 12 minutes."],
};

describe("extractRecipe", () => {
  it("pulls name, ingredient lines, steps and yield from a JSON-LD Recipe", () => {
    const result = extractRecipe(page(COOKIES));

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.recipe).toEqual({
      name: "Chocolate Chip Cookies",
      ingredientLines: ["300 g all-purpose flour", "2 large eggs"],
      steps: ["Mix the dry ingredients.", "Bake for 12 minutes."],
      recipeYield: "24 cookies",
    });
  });

  it("finds the Recipe nested inside an @graph", () => {
    const result = extractRecipe(
      page({
        "@context": "https://schema.org",
        "@graph": [{ "@type": "WebSite", name: "Site" }, COOKIES],
      }),
    );

    expect(result.ok === true && result.recipe.name).toBe("Chocolate Chip Cookies");
  });

  it("finds the Recipe when the script holds a top-level array", () => {
    const result = extractRecipe(page([{ "@type": "Organization", name: "Org" }, COOKIES]));

    expect(result.ok === true && result.recipe.name).toBe("Chocolate Chip Cookies");
  });

  it("accepts a node whose @type is an array containing Recipe", () => {
    const result = extractRecipe(page({ ...COOKIES, "@type": ["NewsArticle", "Recipe"] }));

    expect(result.ok === true && result.recipe.name).toBe("Chocolate Chip Cookies");
  });

  it("reads instructions given as HowToStep objects", () => {
    const result = extractRecipe(
      page({
        ...COOKIES,
        recipeInstructions: [
          { "@type": "HowToStep", text: "Cream the butter." },
          { "@type": "HowToStep", text: "Fold in the flour." },
        ],
      }),
    );

    expect(result.ok === true && result.recipe.steps).toEqual([
      "Cream the butter.",
      "Fold in the flour.",
    ]);
  });

  it("flattens instructions grouped into HowToSections", () => {
    const result = extractRecipe(
      page({
        ...COOKIES,
        recipeInstructions: [
          {
            "@type": "HowToSection",
            name: "Dough",
            itemListElement: [
              { "@type": "HowToStep", text: "Cream the butter." },
              { "@type": "HowToStep", text: "Add the eggs." },
            ],
          },
          { "@type": "HowToStep", text: "Bake." },
        ],
      }),
    );

    expect(result.ok === true && result.recipe.steps).toEqual([
      "Cream the butter.",
      "Add the eggs.",
      "Bake.",
    ]);
  });

  it("splits instructions given as one HTML-free string into steps", () => {
    const result = extractRecipe(
      page({ ...COOKIES, recipeInstructions: "Mix it.\nBake it.\n" }),
    );

    expect(result.ok === true && result.recipe.steps).toEqual(["Mix it.", "Bake it."]);
  });

  it("normalises a numeric or array recipeYield to a string", () => {
    const numeric = extractRecipe(page({ ...COOKIES, recipeYield: 24 }));
    expect(numeric.ok === true && numeric.recipe.recipeYield).toBe("24");

    const list = extractRecipe(page({ ...COOKIES, recipeYield: ["24", "24 cookies"] }));
    expect(list.ok === true && list.recipe.recipeYield).toBe("24");
  });

  it("reports a missing yield as null rather than inventing a serving count", () => {
    // JSON.stringify drops undefined properties, so the block carries no yield.
    const result = extractRecipe(page({ ...COOKIES, recipeYield: undefined }));

    expect(result.ok === true && result.recipe.recipeYield).toBeNull();
  });

  it("accepts a single ingredient line given as a bare string", () => {
    const result = extractRecipe(page({ ...COOKIES, recipeIngredient: "1 cup flour" }));

    expect(result.ok === true && result.recipe.ingredientLines).toEqual(["1 cup flour"]);
  });

  it("tolerates extra attributes and odd quoting on the script tag", () => {
    const result = extractRecipe(page(COOKIES, "id='r' TYPE = 'application/ld+json' async"));

    expect(result.ok === true && result.recipe.name).toBe("Chocolate Chip Cookies");
  });

  it("fails explicitly when the page has no JSON-LD at all", () => {
    // No scraping fallback in v1 — a page without JSON-LD is a hard failure
    // (SPEC.md §3 Alternatives rejected).
    const result = extractRecipe(
      "<html><body><h1>Cookies</h1><ul><li>300g flour</li></ul></body></html>",
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("no-jsonld");
  });

  it("fails when JSON-LD is present but describes no Recipe", () => {
    const result = extractRecipe(page({ "@type": "WebSite", name: "Some blog" }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("no-recipe");
  });

  it("skips an unparseable block and still finds a valid Recipe later in the page", () => {
    const html =
      page("{ this is not json }") +
      page(COOKIES);
    const result = extractRecipe(html);

    expect(result.ok === true && result.recipe.name).toBe("Chocolate Chip Cookies");
  });

  it("fails when the Recipe carries no ingredient lines to map", () => {
    const result = extractRecipe(page({ ...COOKIES, recipeIngredient: [] }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("recipe-without-ingredients");
  });

  it("scans a page full of unterminated script tags in linear time", { timeout: 5_000 }, () => {
    // A regex scanner backtracks quadratically here: 256 KB (an eighth of what
    // the fetcher will accept) took ~10s, and 2 MB took minutes of blocked
    // event loop. The timeout is the assertion.
    const html = page(COOKIES) + "<script".repeat((256 * 1024) / 7);

    expect(extractRecipe(html).ok).toBe(true);
  });

  it("finds a recipe on a page containing characters that change length when lowercased", () => {
    // "İ".toLowerCase() is two chars, so scanning a lowercased copy of the page
    // and slicing the original desynchronises the indices.
    const result = extractRecipe(`<p>Kayısı İzmir İstanbul</p>${page(COOKIES)}`);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.recipe.name).toBe("Chocolate Chip Cookies");
  });

  it("does not treat a tag merely starting with 'script' as a script element", () => {
    const html = `<scriptx type="application/ld+json">${JSON.stringify(COOKIES)}</scriptx>`;

    expect(extractRecipe(html).ok).toBe(false);
  });

  it("refuses a recipe with more ingredient lines than a person would confirm", () => {
    // The review screen renders one row per line; an unbounded list is a
    // denial-of-service against the user, not just the server.
    const result = extractRecipe(
      page({ ...COOKIES, recipeIngredient: Array<string>(5_000).fill("1 cup flour") }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("recipe-too-large");
  });

  it("refuses a recipe with an implausible number of steps", () => {
    const result = extractRecipe(
      page({ ...COOKIES, recipeInstructions: Array<string>(5_000).fill("Stir.") }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("recipe-too-large");
  });

  it("ignores a script block that is not ld+json", () => {
    const html = `<script type="application/json">${JSON.stringify(COOKIES)}</script>`;
    const result = extractRecipe(html);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.reason).toBe("no-jsonld");
  });
});
