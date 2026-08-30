import { beforeEach, describe, expect, it, vi } from "vitest";

import { createIngredient, listIngredients } from "./queries/ingredients";
import { findRecipeWithLines, listRecipes } from "./queries/recipes";
import { unsafeHouseholdScopeFromId, type HouseholdScope } from "./scope";
import { resetDatabase, seedHousehold, type SeededHousehold } from "./testing/harness";
import type { FetchPageDeps } from "@/lib/import/fetch-page";
import type { ImportDraft } from "@/lib/recipes/import-draft";
import { parseRecipeForm } from "@/lib/recipes/form";
import { importRecipeFromUrl, saveRecipeDraft } from "@/lib/recipes/service";

/**
 * The URL import flow against real rows (SPEC.md §3, §5).
 *
 * The parsing halves are covered exhaustively without a database elsewhere —
 * `jsonld.test.ts`, `parse-line.test.ts`, `import-draft.test.ts`, and
 * `fetch-page.test.ts` for the SSRF guard. What only shows up here is the part
 * the spec is most insistent about: that phase one writes *nothing*, and that
 * what phase two writes lands in the confirming household's own catalog.
 *
 * The network and the resolver are stubbed; nothing else is. Those are process
 * boundaries, and stubbing them is what makes the test deterministic.
 */

let alpha: SeededHousehold;
let scope: HouseholdScope;

beforeEach(async () => {
  await resetDatabase();
  alpha = await seedHousehold("Alpha");
  scope = unsafeHouseholdScopeFromId(alpha.householdId);
});

const COOKIES = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Chocolate Chip Cookies",
  recipeYield: "24 cookies",
  recipeIngredient: ["300 g all-purpose flour", "200 g granulated sugar", "2 large eggs"],
  recipeInstructions: ["Cream the butter.", "Bake for 12 minutes."],
};

function page(jsonLd: unknown): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(
    jsonLd,
  )}</script></head><body></body></html>`;
}

/** A public address, so the guard lets the stubbed fetch happen. */
const PUBLIC_LOOKUP = async () => ["93.184.216.34"];

function serving(html: string): FetchPageDeps {
  return {
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
  };
}

/** What the review screen posts back once the user has confirmed it. */
function confirmed(draft: ImportDraft): FormData {
  const data = new FormData();
  data.set("name", draft.name);
  data.set("baseServings", draft.baseServings);
  data.set("steps", draft.steps);
  data.set("sourceUrl", draft.sourceUrl);
  for (const line of draft.lines) {
    data.append("ingredientName", line.name);
    data.append("ingredientQuantity", line.quantity);
    data.append("ingredientUnit", line.unitId);
    data.append("ingredientDensity", "");
  }
  return data;
}

async function catalogNames(): Promise<string[]> {
  return (await listIngredients(scope)).map((row) => row.name);
}

describe("fetching a recipe for review", () => {
  it("writes nothing at all before the user confirms", async () => {
    // SPEC.md §3 step 5 and §5: the review screen is reached without a single
    // row being created, so an import abandoned here leaves no trace.
    const before = { recipes: await listRecipes(scope), catalog: await catalogNames() };

    const result = await importRecipeFromUrl(
      scope,
      "https://example.com/cookies",
      serving(page(COOKIES)),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.draft.lines).toHaveLength(3);

    expect(await listRecipes(scope)).toEqual(before.recipes);
    expect(await catalogNames()).toEqual(before.catalog);
  });

  it("fails explicitly on a page with no recipe markup, leaving nothing behind", async () => {
    const result = await importRecipeFromUrl(
      scope,
      "https://example.com/blog",
      serving("<html><body><h1>Cookies</h1><ul><li>300g flour</li></ul></body></html>"),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/no recipe/i);
    expect(await listRecipes(scope)).toHaveLength(1);
  });

  it("refuses a URL that resolves to a private address before opening a connection", async () => {
    // SPEC.md §5 wants the guard proven to fire *before* the request, not just
    // that the import failed — so the stub fails the test if it is ever called.
    const result = await importRecipeFromUrl(scope, "https://intranet.example.com/cookies", {
      lookup: async () => ["169.254.169.254"],
      fetchImpl: async () => {
        throw new Error("the fetcher reached the network for a blocked address");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/public http/i);
  });

  it("never writes a pasted URL's credentials into the log", async () => {
    // SPEC.md §4 has the fetcher log its target and outcome, and in the same
    // breath says never to log a password. The guard rejects this URL *because*
    // the userinfo is a credential, which makes the rejection the exact line
    // that would carry it.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const result = await importRecipeFromUrl(
        scope,
        "https://alice:hunter2@example.com/recipe?sig=abc123",
        serving(page(COOKIES)),
      );

      expect(result.ok).toBe(false);

      const logged = info.mock.calls.flat().join(" ");
      expect(logged).toContain("blocked-credentials");
      expect(logged).not.toContain("hunter2");
      expect(logged).not.toContain("alice");
      expect(logged).not.toContain("abc123");
    } finally {
      info.mockRestore();
    }
  });

  it("suggests only the confirming household's own catalog entries", async () => {
    // SPEC.md §5: catalog lookups during import-mapping must not surface
    // another household's ingredients. Beta has "Sugar"; Alpha does not.
    const beta = await seedHousehold("Beta");
    await createIngredient(unsafeHouseholdScopeFromId(beta.householdId), { name: "Sugar" });

    const result = await importRecipeFromUrl(
      scope,
      "https://example.com/cookies",
      serving(page(COOKIES)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Alpha's own "Flour" is offered for the flour line...
    expect(result.draft.lines[0]).toMatchObject({ name: "Flour", fromCatalog: true });
    // ...and Beta's "Sugar" is not offered for the sugar line.
    expect(result.draft.lines[1]).toMatchObject({
      name: "granulated sugar",
      fromCatalog: false,
    });
  });
});

describe("saving a reviewed import", () => {
  async function importDraft(): Promise<ImportDraft> {
    const result = await importRecipeFromUrl(
      scope,
      "https://example.com/cookies",
      serving(page(COOKIES)),
    );
    if (!result.ok) throw new Error(`import failed: ${result.message}`);
    return result.draft;
  }

  it("records the page the recipe came from", async () => {
    const parsed = parseRecipeForm(confirmed(await importDraft()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const saved = await saveRecipeDraft(scope, parsed.value);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const stored = await findRecipeWithLines(scope, saved.id);
    expect(stored?.sourceUrl).toBe("https://example.com/cookies");
    expect(stored?.baseServings).toBe(24);
  });

  it("resolves every confirmed line into this household's catalog", async () => {
    const parsed = parseRecipeForm(confirmed(await importDraft()));
    if (!parsed.ok) throw new Error("the confirmed draft did not parse");

    const saved = await saveRecipeDraft(scope, parsed.value);
    if (!saved.ok) throw new Error("the confirmed draft did not save");

    const stored = await findRecipeWithLines(scope, saved.id);
    expect(stored?.lines.map((line) => line.ingredient.name).sort()).toEqual([
      "Flour",
      "granulated sugar",
      "large eggs",
    ]);
    // The line that matched the catalog reuses the entry rather than adding a
    // near-duplicate beside it.
    expect(stored?.lines.every((line) => line.ingredient.householdId === alpha.householdId)).toBe(
      true,
    );
    expect(await catalogNames()).toEqual(["Flour", "granulated sugar", "large eggs"]);
  });

  it("keeps no source URL on a recipe that was typed in rather than imported", async () => {
    const data = confirmed(await importDraft());
    data.delete("sourceUrl");

    const parsed = parseRecipeForm(data);
    if (!parsed.ok) throw new Error("the manual recipe did not parse");

    const saved = await saveRecipeDraft(scope, parsed.value);
    if (!saved.ok) throw new Error("the manual recipe did not save");

    expect((await findRecipeWithLines(scope, saved.id))?.sourceUrl).toBeNull();
  });
});
