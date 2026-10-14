import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { InviteListing } from "@/db/queries/invites";
import { classCandidates, compileCandidates, selectorPattern } from "@/design/utilities";
import { matchRecipe } from "@/lib/matching/match";
import { BUCKET_ORDER, recipeBucket, type RecipeBucket } from "@/lib/matching/summary";
import type { Ingredient, LineStatus, PantryItem, Recipe } from "@/lib/matching/types";
import { UNITS } from "@/lib/matching/units";
import type { ImportDraft } from "@/lib/recipes/import-draft";

import { HouseholdScreen } from "./household/household-screen";
import { IssuedInvite } from "./household/invite-button";
import { JoinForm } from "./join/[token]/join-form";
import LoginPage from "./login/page";
import { PantryScreen } from "./pantry/pantry-screen";
import { RecipeScreen } from "./recipes/[id]/recipe-screen";
import { RecipeForm } from "./recipes/_components/recipe-form";
import { ImportFlow } from "./recipes/import/import-flow";
import { RecipeListScreen } from "./recipes/recipe-list-screen";
import SignupPage from "./signup/page";

/**
 * The restyle of every existing screen (SPEC.md §2 item 5), rendered.
 *
 * Each data-reading page is split the way `shell.tsx` splits `AppShell` from
 * `Header`: `page.tsx` keeps the session check and the queries, and a
 * `*Screen` component takes plain props and holds the markup. That is what
 * lets this file render every screen in the app with no database, no request
 * and no mocks — the match results below come from the real engine.
 *
 * What is asserted is what a restyle can break without anyone seeing it in a
 * screenshot: a class that compiles to nothing, a control too small for a
 * thumb, a table that pushes a phone's viewport sideways, a status reduced to
 * a colour, and the label and description wiring that only a screen reader
 * notices is gone. Whether it *looks* right is §6's walk-through by eye.
 */

/* --------------------------------------------------------------- fixtures */

const CHICKPEAS: Ingredient = { id: "chickpeas", name: "Chickpeas" };
const TOMATOES: Ingredient = { id: "tomatoes", name: "Tomatoes" };
const CORIANDER: Ingredient = { id: "coriander", name: "Coriander" };
// No density, and held by volume against a recipe that wants grams: the
// "can't verify" path.
const RICE: Ingredient = { id: "rice", name: "Basmati rice" };

const PANTRY: readonly PantryItem[] = [
  { ingredient: CHICKPEAS, quantity: { value: 500, unit: UNITS.g } },
  { ingredient: TOMATOES, quantity: { value: 100, unit: UNITS.g } },
  { ingredient: RICE, quantity: { value: 250, unit: UNITS.ml } },
];

const CHANA_MASALA: Recipe = {
  name: "Chana masala",
  baseServings: 4,
  ingredients: [
    { ingredient: CHICKPEAS, quantity: { value: 240, unit: UNITS.g } },
    { ingredient: TOMATOES, quantity: { value: 400, unit: UNITS.g } },
    { ingredient: CORIANDER, quantity: { value: 1, unit: UNITS.count } },
    { ingredient: RICE, quantity: { value: 200, unit: UNITS.g } },
  ],
};

const HUMMUS: Recipe = {
  name: "Hummus",
  baseServings: 2,
  ingredients: [{ ingredient: CHICKPEAS, quantity: { value: 200, unit: UNITS.g } }],
};

/** Tomatoes short and nothing else: Needs shopping. */
const TOMATO_SOUP: Recipe = {
  name: "Tomato soup",
  baseServings: 2,
  ingredients: [{ ingredient: TOMATOES, quantity: { value: 400, unit: UNITS.g } }],
};

/** Grams of rice against millilitres held, with no density: Can't verify. */
const RICE_PUDDING: Recipe = {
  name: "Rice pudding",
  baseServings: 4,
  ingredients: [{ ingredient: RICE, quantity: { value: 200, unit: UNITS.g } }],
};

/** One of every line status at once. */
const RESULT = matchRecipe(CHANA_MASALA, PANTRY);
const NOTHING_LISTED = matchRecipe({ ...CHANA_MASALA, ingredients: [] }, PANTRY);

const SOURCE_URL = "https://www.bbcgoodfood.com/recipes/chana-masala";

const RECIPE = {
  id: "8f1c2e9a-0b7d-4c55-9a3e-2d6f1b0c4e71",
  name: CHANA_MASALA.name,
  baseServings: CHANA_MASALA.baseServings,
  sourceUrl: SOURCE_URL,
  steps: ["Fry the onion until soft.", "Add the spices, then the tomatoes.", "Stir in the chickpeas."],
};

const HUMMUS_ENTRY = {
  id: "1d4a7c00-5e2b-4f61-8c3d-9b0e7a6f2d18",
  name: HUMMUS.name,
  baseServings: 2,
  result: matchRecipe(HUMMUS, PANTRY),
};

/**
 * In name order, as `listRecipesWithLines` hands them to the page — which is
 * nowhere near bucket order, so the grouping has something to do.
 */
const ENTRIES = [
  { id: RECIPE.id, name: RECIPE.name, baseServings: 4, result: RESULT },
  HUMMUS_ENTRY,
  { id: "2e5b8d11-6f3c-4a72-9d4e-0c1f8b7a3e29", name: RICE_PUDDING.name, baseServings: 4, result: matchRecipe(RICE_PUDDING, PANTRY) },
  { id: "3f6c9e22-7a4d-4b83-8e5f-1d2a9c8b4f3a", name: TOMATO_SOUP.name, baseServings: 2, result: matchRecipe(TOMATO_SOUP, PANTRY) },
];

const CATALOG = ["Basmati rice", "Chickpeas", "Coriander", "Tomatoes"];

const DRAFT: ImportDraft = {
  sourceUrl: SOURCE_URL,
  name: "Chana masala",
  baseServings: "4",
  // The page gave no yield, so the 4 above is this app's guess.
  servingsStated: false,
  steps: "Fry the onion until soft.\nAdd the spices.",
  lines: [
    { raw: "2 x 400g cans chickpeas", name: "Chickpeas", quantity: "800", unitId: "g", confidence: "high", fromCatalog: true },
    { raw: "a small bunch of coriander", name: "coriander", quantity: "", unitId: "", confidence: "low", fromCatalog: false },
  ],
};

const PANTRY_ITEMS = [
  { id: "4b6e1f0a-2c3d-4e5f-8a9b-0c1d2e3f4a5b", name: "Chickpeas", quantity: 500, unitId: "g", densityGPerMl: null },
  { id: "5c7f2a1b-3d4e-4f60-9b0c-1d2e3f4a5b6c", name: "Plain flour", quantity: 1, unitId: "kg", densityGPerMl: 0.53 },
];

const CREATED = new Date("2026-10-01T09:00:00Z");

const INVITES: readonly InviteListing[] = (["open", "used", "expired"] as const).map((status, index) => ({
  id: `0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6${index}`,
  householdId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  createdBy: "u1",
  createdAt: CREATED,
  expiresAt: new Date("2026-10-08T09:00:00Z"),
  usedAt: status === "used" ? CREATED : null,
  status,
}));

/**
 * Every screen in the app, and every state of one that changes what is drawn.
 *
 * `/recipes/new` and `/recipes/import` are their forms: those two pages are a
 * `PageHeader` around one component and nothing else, and the header is
 * `ui/` vocabulary that `src/design/utilities.test.tsx` already compiles.
 * `/join/[token]` is its form for the same reason; its other branch is
 * `AuthPage` around one sentence and a `LinkButton`.
 */
const SCREENS: ReadonlyArray<readonly [string, ReactElement]> = [
  ["/login", <LoginPage key="login" />],
  ["/signup", <SignupPage key="signup" />],
  ["/join/[token] form", <JoinForm key="join" token="f00dcafe" />],
  ["/recipes", <RecipeListScreen key="recipes" entries={ENTRIES} pantryIsEmpty={false} />],
  ["/recipes, empty pantry", <RecipeListScreen key="empty-pantry" entries={ENTRIES} pantryIsEmpty />],
  ["/recipes, no recipes", <RecipeListScreen key="no-recipes" entries={[]} pantryIsEmpty />],
  ["/recipes, all ready", <RecipeListScreen key="all-ready" entries={[HUMMUS_ENTRY]} pantryIsEmpty={false} />],
  ["/recipes/new form", <RecipeForm key="new" catalog={CATALOG} />],
  ["/recipes/import form", <ImportFlow key="import" catalog={CATALOG} />],
  ["/recipes/import review", <RecipeForm key="review" catalog={CATALOG} initial={DRAFT} />],
  ["/recipes/[id]", <RecipeScreen key="recipe" recipe={RECIPE} servings={4} result={RESULT} />],
  [
    "/recipes/[id], nothing listed",
    <RecipeScreen
      key="bare"
      recipe={{ ...RECIPE, sourceUrl: null, steps: [] }}
      servings={4}
      result={NOTHING_LISTED}
    />,
  ],
  [
    "/pantry",
    <PantryScreen
      key="pantry"
      items={PANTRY_ITEMS}
      catalog={CATALOG.map((name, index) => ({ id: `ingredient-${index}`, name }))}
    />,
  ],
  // An empty catalog opens the add form on "new ingredient", which is the
  // branch that draws the name and density fields.
  ["/pantry, empty", <PantryScreen key="empty" items={[]} catalog={[]} />],
  [
    "/household",
    <HouseholdScreen
      key="household"
      householdName="Ashby Road"
      email="someone@example.test"
      currentUserId="u1"
      members={[
        { id: "u1", email: "someone@example.test", createdAt: CREATED },
        { id: "u2", email: "a-much-longer-address-than-usual@example.test", createdAt: CREATED },
      ]}
      invites={INVITES}
    />,
  ],
  [
    "/household, invite just issued",
    <IssuedInvite
      key="issued"
      link="http://192.168.1.20:3000/join/3q2-uVb0x8Y4mZ1cK7wT9sLhA5eR6dGj"
      expiresAt="2026-10-08T09:00:00.000Z"
    />,
  ],
];

const MARKUP = new Map(SCREENS.map(([name, element]) => [name, renderToStaticMarkup(element)]));

const NAMES = SCREENS.map(([name]) => name);

function markupOf(name: string): string {
  return MARKUP.get(name) ?? "";
}

/* ------------------------------------------------------------- markup */

type Tag = { readonly name: string; readonly attributes: string };

/**
 * Opening tags, read off React's own output. `[^>]*` is safe there and only
 * there: React escapes `>` inside attribute values, so the first `>` closes
 * the tag.
 */
function openingTags(markup: string, names: readonly string[]): readonly Tag[] {
  return [...markup.matchAll(new RegExp(`<(${names.join("|")})\\b([^>]*)>`, "g"))].map(
    (match) => ({ name: match[1] ?? "", attributes: match[2] ?? "" }),
  );
}

function attribute(tag: Tag, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag.attributes)?.[1];
}

function classesOf(tag: Tag): readonly string[] {
  return (attribute(tag, "class") ?? "").split(/\s+/).filter((part) => part !== "");
}

function describeTag(tag: Tag): string {
  return `<${tag.name}${tag.attributes}>`;
}

/** What a finger can land on. A hidden input is not on the screen at all. */
function targets(markup: string): readonly Tag[] {
  return openingTags(markup, ["a", "button", "input", "select", "textarea", "summary"]).filter(
    (tag) => attribute(tag, "type") !== "hidden",
  );
}

function controls(markup: string): readonly Tag[] {
  return targets(markup).filter((tag) => ["input", "select", "textarea"].includes(tag.name));
}

/* ------------------------------------------------------------ the tests */

describe("the fixtures", () => {
  it("cover every line status, so every badge is drawn", () => {
    const statuses: readonly LineStatus[] = ["have", "short", "missing", "unresolved"];

    expect(new Set(RESULT.lines.map((line) => line.status))).toEqual(new Set(statuses));
  });

  it("include a recipe that is makeable and one that is not", () => {
    expect(new Set(ENTRIES.map(({ result }) => result.makeable))).toEqual(new Set([false, true]));
  });

  it("put a recipe in every bucket, so every heading is drawn", () => {
    expect(new Set(ENTRIES.map(({ result }) => recipeBucket(result)))).toEqual(
      new Set(BUCKET_ORDER),
    );
  });

  it("arrive out of bucket order, so the grouping is what orders them", () => {
    const buckets = ENTRIES.map(({ result }) => BUCKET_ORDER.indexOf(recipeBucket(result)));

    expect(buckets).not.toEqual([...buckets].sort((a, b) => a - b));
  });

  it("render something to look at on every screen", () => {
    // Collected from markup that actually rendered — a screen that threw
    // would fail here rather than pass every check below with nothing in it.
    for (const name of NAMES) {
      expect(markupOf(name).length, name).toBeGreaterThan(100);
    }
    expect(NAMES.flatMap((name) => targets(markupOf(name))).length).toBeGreaterThan(50);
  });
});

const COMPILED = await compileCandidates(
  [...new Set(NAMES.flatMap((name) => classCandidates(markupOf(name))))],
);

describe.each(NAMES)("%s", (name) => {
  const markup = markupOf(name);

  it("ships only classes that compile to a rule", () => {
    // Tailwind's answer to a typo is no rule at all, and on a dark surface an
    // unstyled element is often an invisible one.
    const dead = classCandidates(markup).filter(
      (candidate) => !selectorPattern(candidate).test(COMPILED),
    );

    expect(dead).toEqual([]);
  });

  it("keeps every colour on a token, with no arbitrary values", () => {
    // `text-[#b00020]` compiles perfectly well, and is the hardcoded error
    // colour SPEC.md §1 exists to remove — with no dark variant and no
    // contrast assertion behind it.
    expect(classCandidates(markup).filter((candidate) => candidate.includes("["))).toEqual([]);
  });

  it("gives every control a thumb-sized target", () => {
    // SPEC.md §2 item 9: every interactive target at least 44x44 CSS px. The
    // height is `min-h-tap` everywhere; the width is `min-w-tap` or the full
    // width of the container. A <summary> is block-level and spans its
    // container without being told to.
    for (const tag of targets(markup)) {
      const classes = classesOf(tag);

      expect(classes, describeTag(tag)).toContain("min-h-tap");
      if (tag.name !== "summary") {
        expect(
          classes.includes("min-w-tap") || classes.includes("w-full"),
          `${describeTag(tag)} has no minimum width`,
        ).toBe(true);
      }
    }
  });

  it("labels every form control", () => {
    for (const tag of controls(markup)) {
      const id = attribute(tag, "id");
      const labelled =
        attribute(tag, "aria-label") !== undefined ||
        (id !== undefined && markup.includes(`for="${id}"`));

      expect(labelled, `${describeTag(tag)} has no label`).toBe(true);
    }
  });

  it("points every description at something on the page", () => {
    // A dangling `aria-describedby` looks identical to a working one, and
    // only a screen reader user finds out.
    const promised = [...markup.matchAll(/aria-describedby="([^"]*)"/g)].flatMap((match) =>
      (match[1] ?? "").split(" "),
    );

    expect(promised.filter((id) => !markup.includes(`id="${id}"`))).toEqual([]);
  });

  it("gives every id to exactly one element", () => {
    // Every table renders its rows twice (SPEC.md §3.6), once per layout. An
    // id in a cell would be an id on the page twice, and a <label for> that
    // finds the wrong one.
    const ids = [...markup.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);

    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("never lets a table push a phone's viewport sideways", () => {
    // Every <table> is the from-`sm` half of a `DataTable`, out of the layout
    // below it, where the same rows are cards. Not `overflow-x: auto`.
    const tables = openingTags(markup, ["table"]).length;
    const collapsing = [...markup.matchAll(/<div class="([^"]*)"><table\b/g)].filter((match) => {
      const classes = (match[1] ?? "").split(/\s+/);
      return classes.includes("hidden") && classes.includes("sm:block");
    }).length;

    expect(collapsing).toBe(tables);
  });

  it("leaves navigation to the shell", () => {
    // SPEC.md §3.3 deletes the `·`-separated line of links each page wrote
    // for itself; the shell's nav is the only copy now, and contextual
    // actions are buttons in the page header.
    expect(markup).not.toMatch(/<\/a>\s*·/);
  });
});

describe("/recipes", () => {
  const markup = markupOf("/recipes");

  /** Where a bucket's heading opens, or -1 if it has none. */
  function headingAt(source: string, bucket: RecipeBucket): number {
    return source.search(new RegExp(`<h2\\b[^>]*\\sid="bucket-${bucket}"`));
  }

  /** A bucket's heading, from its opening tag to its close. */
  function heading(bucket: RecipeBucket): string {
    const start = headingAt(markup, bucket);
    return start === -1 ? "" : markup.slice(start, markup.indexOf("</h2>", start));
  }

  const TONE: Record<RecipeBucket, string> = {
    ready: "ok",
    shopping: "warn",
    "partly-unverifiable": "mixed",
    unverifiable: "unknown",
  };

  it("links every recipe to its own page", () => {
    for (const { id } of ENTRIES) {
      expect(markup).toContain(`href="/recipes/${id}"`);
    }
  });

  it("draws the four headings most actionable first", () => {
    // SPEC.md §3.5: ready → shopping → partly-unverifiable → unverifiable.
    const positions = BUCKET_ORDER.map((bucket) => headingAt(markup, bucket));

    expect(positions.every((position) => position !== -1), String(positions)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it.each(ENTRIES.map((entry) => [entry.name, entry] as const))(
    "files %s under its own heading and no other",
    (_name, { id, result }) => {
      // The recipe is drawn twice — table and cards — and both copies have to
      // sit between its bucket's heading and the next one.
      const bucket = recipeBucket(result);
      const start = headingAt(markup, bucket);
      const next = BUCKET_ORDER.slice(BUCKET_ORDER.indexOf(bucket) + 1)
        .map((later) => headingAt(markup, later))
        .find((position) => position !== -1);
      const links = [...markup.matchAll(new RegExp(`href="/recipes/${id}"`, "g"))].map(
        (match) => match.index,
      );

      expect(start, `no heading for ${bucket}`).not.toBe(-1);
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toBeGreaterThan(start);
        if (next !== undefined) expect(link).toBeLessThan(next);
      }
    },
  );

  it.each(BUCKET_ORDER)("says how many recipes are in %s, in words", (bucket) => {
    // One recipe per bucket in the fixtures. The space is what keeps the
    // heading's accessible name from running the label into the count.
    expect(heading(bucket)).toMatch(/<\/span> <span[^>]*>1 recipe</);
  });

  it("counts more than one in the plural", () => {
    const twoReady = renderToStaticMarkup(
      <RecipeListScreen
        entries={[HUMMUS_ENTRY, { ...HUMMUS_ENTRY, id: "4a7d0f33-8b5e-4c94-9f60-2e3b0d9c5a4b" }]}
        pantryIsEmpty={false}
      />,
    );

    expect(twoReady).toContain(">2 recipes<");
  });

  it.each(BUCKET_ORDER)("draws the %s heading as a badge with its glyph", (bucket) => {
    // SPEC.md §3.5's table: every bucket heading is a token, a glyph and a
    // label. The label is `badge.test.tsx`'s to check; this checks that the
    // heading is that badge rather than a bare word.
    expect(heading(bucket)).toMatch(
      new RegExp(`class="[^"]*\\bbg-status-${TONE[bucket]}\\b[^"]*"><svg\\b`),
    );
  });

  it("names each group by its heading, so a screen reader can jump between them", () => {
    for (const bucket of BUCKET_ORDER) {
      expect(markup).toMatch(new RegExp(`<section\\b[^>]*aria-labelledby="bucket-${bucket}"`));
    }
  });

  it("draws no heading for a bucket nothing falls into", () => {
    // SPEC.md §3.5: "Empty buckets render no heading."
    const allReady = markupOf("/recipes, all ready");

    expect(BUCKET_ORDER.filter((bucket) => headingAt(allReady, bucket) !== -1)).toEqual(["ready"]);
  });

  it("puts nothing in a bucket heading when there are no recipes at all", () => {
    expect(markupOf("/recipes, no recipes")).not.toContain('id="bucket-');
  });
});

describe("/recipes/[id]", () => {
  const TONE: Record<LineStatus, string> = {
    have: "ok",
    short: "warn",
    missing: "gap",
    unresolved: "unknown",
  };

  it.each(Object.entries(TONE))("draws a %s line as a badge with its glyph", (_status, tone) => {
    // SPEC.md §3.5: colour never carries a status alone. `badge.test.tsx`
    // holds the badge to token + glyph + label; this holds the screen to
    // using it rather than printing the status as a word in a cell.
    expect(markupOf("/recipes/[id]")).toMatch(
      new RegExp(`class="[^"]*\\bbg-status-${tone}\\b[^"]*"><svg\\b`),
    );
  });

  it("shows where an imported recipe came from as text, never as a link", () => {
    // It is a URL a user pasted. `LinkButton`'s own docs explain why opening
    // it needs a different component that does not exist yet.
    const markup = markupOf("/recipes/[id]");
    const hrefs = [...markup.matchAll(/\shref="([^"]*)"/g)].map((match) => match[1] ?? "");

    expect(markup).toContain(SOURCE_URL);
    // Not merely "not this exact href": a redirector (`/out?to=…`), a
    // trailing slash or an encoded copy would all slip past that. No link on
    // the screen leaves the app, and none carries the source's host at all.
    expect(hrefs.filter((href) => !href.startsWith("/") || href.startsWith("//"))).toEqual([]);
    expect(hrefs.filter((href) => href.includes(new URL(SOURCE_URL).hostname))).toEqual([]);
  });
});
