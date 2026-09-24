import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

import { AccountPanel } from "@/app/_components/account-menu";
import { PlusIcon } from "@/app/_components/icons";
import { Header } from "@/app/_components/shell";
import { Badge, STATUS_TONES, StatusBadge } from "@/app/_components/ui/badge";
import { Button, BUTTON_SIZES, BUTTON_VARIANTS, LinkButton } from "@/app/_components/ui/button";
import { Card, CardHeader } from "@/app/_components/ui/card";
import { EmptyState } from "@/app/_components/ui/empty-state";
import { controlClass, Field, FormMessage } from "@/app/_components/ui/field";
import { PageHeader } from "@/app/_components/ui/page-header";
import ErrorScreen from "@/app/error";
import HouseholdLoading from "@/app/household/loading";
import NotFound from "@/app/not-found";
import PantryLoading from "@/app/pantry/loading";
import RecipeLoading from "@/app/recipes/[id]/loading";
import RecipesLoading from "@/app/recipes/loading";
import type { LineStatus } from "@/lib/matching/types";

/**
 * The component vocabulary of SPEC.md §3.6 is, almost entirely, class names in
 * string literals. Nothing else in the suite can tell `bg-surface-raised` from
 * `bg-surface-raise`: TypeScript sees two strings, ESLint sees two strings, and
 * Tailwind's answer to a class it does not recognise is to emit no rule at all.
 * The component then renders with the typo intact and no styling, which on a
 * dark background is invisible text rather than an obvious break.
 *
 * So: render the whole vocabulary, harvest every class it actually ships, and
 * put each one through the real compiler against the real `globals.css`. A
 * token dropped from `@theme inline` fails here too — `--surface-raised`
 * declared but not mapped generates no `bg-surface-raised`, which is exactly
 * the failure `tokens.test.ts` cannot see from the stylesheet alone.
 *
 * This uses `tailwindcss` directly rather than the PostCSS plugin. Both are
 * already devDependencies; the plugin would add a `postcss` import for a
 * wrapper this needs nothing from.
 */

const STATUSES: readonly LineStatus[] = ["have", "short", "missing", "unresolved"];

/** Every component, in every variant it has. A variant left out is unchecked. */
const GALLERY = (
  <>
    {BUTTON_VARIANTS.map((variant) =>
      BUTTON_SIZES.map((size) => (
        <Button key={`${variant}-${size}`} variant={variant} size={size} disabled>
          Save
        </Button>
      )),
    )}
    <LinkButton href="/recipes/new">Add a recipe</LinkButton>

    {STATUS_TONES.map((tone) => (
      <Badge key={tone} tone={tone}>
        Tone
      </Badge>
    ))}
    {STATUSES.map((status) => (
      <StatusBadge key={status} status={status} />
    ))}

    <PageHeader
      title="What can I make?"
      description="Against everything in the pantry right now."
      action={<LinkButton href="/recipes/import">Import from a URL</LinkButton>}
    />

    <Card>
      <CardHeader title="Chana masala" action={<Button size="sm">Edit</Button>} />
    </Card>
    <Card as="li" className="mt-1">
      Chickpeas
    </Card>

    <EmptyState icon={<PlusIcon />} action={<LinkButton href="/pantry">Add what you have</LinkButton>}>
      The pantry is empty.
    </EmptyState>

    <Field id="quantity" label="Amount" hint="Grams, millilitres or a count." error="Not a number">
      <input id="quantity" name="quantity" className={controlClass} />
    </Field>
    <FormMessage message="Email or password is wrong" />

    {/*
      The app shell of SPEC.md §3.3, which is where most of the responsive
      classes in this app live — `sm:` variants that no other test renders and
      that a browser only disagrees with at one width.

      `AccountPanel` is listed separately because `Header` renders the account
      menu shut, so the panel's own classes are not in that markup at all.
    */}
    <Header householdName="Ashby Road" email="someone@example.test" theme="system" />
    <AccountPanel email="someone@example.test" />

    {/*
      The route-level states of SPEC.md §3.7. The four real `loading.tsx`
      rather than a stand-in built from the same pieces: every bar in them
      carries its own width and spacing, and a stand-in would leave exactly
      those uncovered. They are the case this file exists for — a mistyped
      `bg-borde` compiles to nothing, and a placeholder bar with no background
      is an invisible one, which is a loading screen that looks finished and
      empty on every route at once.
    */}
    <RecipesLoading />
    <PantryLoading />
    <RecipeLoading />
    <HouseholdLoading />
    <ErrorScreen error={Object.assign(new Error("boom"), { digest: "9f2a7c1d" })} retry={() => {}} />
    <NotFound />
  </>
);

/** What the browser would actually receive, deduplicated. */
const CANDIDATES: readonly string[] = [
  ...new Set(
    [...renderToStaticMarkup(GALLERY).matchAll(/class="([^"]*)"/g)]
      .flatMap((match) => (match[1] ?? "").split(/\s+/))
      .filter((candidate) => candidate !== ""),
  ),
].sort();

const require = createRequire(import.meta.url);
const stylesheet = fileURLToPath(new URL("../app/globals.css", import.meta.url));

const compiler = await compile(readFileSync(stylesheet, "utf8"), {
  base: dirname(stylesheet),
  loadStylesheet: async (id: string, base: string) => {
    // `@import "tailwindcss"` is a package, the imports inside it are relative.
    const file = id.startsWith(".")
      ? resolve(base, id)
      : require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id);

    return { path: file, base: dirname(file), content: readFileSync(file, "utf8") };
  },
});

const compiled = compiler.build([...CANDIDATES]);

/**
 * The selector Tailwind writes for a candidate: `sm:flex` becomes `.sm\:flex`.
 *
 * Matched with a trailing boundary, because `compiled` is one string holding
 * every rule and a plain substring test passes for any candidate that is a
 * *prefix* of a real one. `bg-surface-raise` compiles to nothing and would
 * still be found inside `.bg-surface-raised` — which is precisely the typo
 * this file exists to catch, so the boundary is the assertion, not a detail.
 *
 * Two layers of escaping: Tailwind escapes the selector, then the regex has to
 * escape Tailwind's backslashes.
 */
function selectorPattern(candidate: string): RegExp {
  const selector = `.${candidate.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)}`;

  return new RegExp(`${selector.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}(?![\\w-])`);
}

describe("the classes the component vocabulary ships", () => {
  it("are actually collected from the rendered markup", () => {
    // A regex that silently matched nothing would make every assertion below
    // pass vacuously, which is the one way this whole file can lie.
    expect(CANDIDATES.length).toBeGreaterThan(30);
  });

  it.each(CANDIDATES)("%s compiles to a rule", (candidate) => {
    expect(compiled).toMatch(selectorPattern(candidate));
  });

  it("is not fooled by a class that is merely a prefix of a real one", () => {
    // The self-test for the boundary above. Dropping it turns every assertion
    // in this file into one that a one-character truncation slips past.
    expect(compiled).toMatch(selectorPattern("bg-surface-raised"));
    expect(compiled).not.toMatch(selectorPattern("bg-surface-raise"));
    expect(compiled).not.toMatch(selectorPattern("min-h-ta"));
  });

  it("keeps every colour on a token, with no arbitrary values", () => {
    // `bg-[#b00020]` compiles perfectly well and is exactly the hardcoded
    // error colour SPEC.md §1 exists to remove — one that has no dark variant
    // and that no contrast assertion covers. Arbitrary values are how it would
    // come back.
    const arbitrary = CANDIDATES.filter((candidate) => candidate.includes("["));

    expect(arbitrary).toEqual([]);
  });
});
