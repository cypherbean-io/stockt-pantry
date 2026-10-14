import type { ReactElement } from "react";

import { MatchTable, ShoppingList } from "@/app/_components/match";
import { Button } from "@/app/_components/ui/button";
import { controlClass, describedBy, Field } from "@/app/_components/ui/field";
import { PageHeader } from "@/app/_components/ui/page-header";
import { Section } from "@/app/_components/ui/section";
import { deleteRecipeAction } from "@/app/actions/recipes";
import { shoppingList } from "@/lib/matching/match";
import type { MatchResult } from "@/lib/matching/types";
import { MAX_SERVINGS } from "@/lib/recipes/form";

/**
 * What `/recipes/[id]` shows, given the recipe `page.tsx` has already found
 * and matched. Split from the page as `Header` is from `AppShell`, so the
 * markup renders in a test without a database or a request.
 */

export type RecipeSummary = {
  readonly id: string;
  readonly name: string;
  readonly baseServings: number;
  readonly sourceUrl: string | null;
  readonly steps: readonly string[];
};

export function RecipeScreen({
  recipe,
  servings,
  result,
}: {
  readonly recipe: RecipeSummary;
  /** Already parsed and clamped by `parseServings`. */
  readonly servings: number;
  /** Matched at `servings`, not at the recipe's base. */
  readonly result: MatchResult;
}): ReactElement {
  const toBuy = shoppingList(result);

  return (
    <>
      {/* "All recipes" was this page's whole nav line; Recipes is in the shell now. */}
      <PageHeader
        title={recipe.name}
        description={
          recipe.sourceUrl === null ? undefined : (
            // Imported recipes carry the page they came from. It is a URL a
            // user pasted, so it is rendered as plain text rather than as a
            // link — and broken anywhere, because a URL is one long word that
            // would otherwise push a phone's viewport sideways.
            <span className="text-sm wrap-anywhere">Imported from {recipe.sourceUrl}</span>
          )
        }
      />

      <div className="flex flex-col gap-8">
        <Section title="Can I make this?">
          {/*
            A GET form: the servings live in the URL, so a rescaled recipe is a
            link that can be bookmarked or sent. The hint sits under the row
            rather than inside the field, so the button lines up with the input
            and not with the end of a sentence.
          */}
          <form className="mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-32">
                <Field id="servings" label="Servings">
                  <input
                    id="servings"
                    name="servings"
                    type="number"
                    min={1}
                    max={MAX_SERVINGS}
                    step={1}
                    defaultValue={servings}
                    className={controlClass}
                    {...describedBy("servings", { hint: true })}
                  />
                </Field>
              </div>
              <Button type="submit" variant="secondary">
                Rescale
              </Button>
            </div>
            <p id="servings-hint" className="mt-1.5 text-sm text-ink-muted">
              Recipe is written for {recipe.baseServings}.
            </p>
          </form>

          <p className="mb-4 text-ink">
            <strong className="font-semibold">{result.makeable ? "Makeable" : "Not makeable"}</strong>
            {!result.makeable && result.lines.some((line) => line.status === "unresolved") && (
              <span className="text-ink-muted">
                {" "}
                — at least one ingredient cannot be checked without a density.
              </span>
            )}
          </p>

          <MatchTable result={result} />
        </Section>

        <Section
          title="Shopping list"
          description={`What is missing or short at ${servings} servings. Buying it does not update the pantry — re-enter what you bought yourself.`}
        >
          <ShoppingList recipeName={recipe.name} servings={servings} lines={toBuy} />
        </Section>

        <Section title="Steps">
          {recipe.steps.length === 0 ? (
            <p className="text-ink-muted">No steps recorded.</p>
          ) : (
            // `list-decimal` puts back the numbers Tailwind's preflight strips:
            // in a method, the position is the content.
            <ol className="max-w-prose list-decimal space-y-2 pl-6 text-ink marker:text-ink-muted">
              {recipe.steps.map((step, index) => (
                // Steps are free text and may repeat, so the position is the only
                // stable identity available. They are never reordered in place.
                <li key={index} className="pl-1">
                  {step}
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Delete">
          {/*
            Behind a disclosure, so deleting is two deliberate presses rather
            than one stray one. The native marker stays: it is the only "this
            opens" affordance that needs no icon, no script and no
            vendor-prefixed pseudo-element to hide.
          */}
          <details className="rounded-card border border-border bg-surface-raised">
            <summary
              className={
                "min-h-tap cursor-pointer rounded-card px-4 py-2.5 font-medium text-ink " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              }
            >
              Delete this recipe
            </summary>
            <form
              action={deleteRecipeAction}
              className="flex flex-col items-start gap-3 border-t border-border p-4"
            >
              <input type="hidden" name="recipeId" value={recipe.id} />
              <p className="text-sm text-ink-muted">
                This cannot be undone. The ingredients stay in the catalog.
              </p>
              <Button type="submit" variant="danger">
                Yes, delete {recipe.name}
              </Button>
            </form>
          </details>
        </Section>
      </div>
    </>
  );
}
