"use client";

import { useActionState, useState } from "react";

import { importRecipeAction } from "@/app/actions/import";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { controlClass, describedBy, Field } from "@/app/_components/ui/field";
import { Section } from "@/app/_components/ui/section";

import { RecipeForm } from "../_components/recipe-form";

/**
 * The two phases of a URL import on one screen (SPEC.md §3): paste a URL, then
 * review and confirm what came back.
 *
 * The draft lives in this component's action state and nowhere else — not in a
 * table, not in a cache. Closing the tab here loses the import, which is the
 * behaviour SPEC.md §3 step 5 asks for: nothing from a fetch is persisted
 * before the user confirms it.
 *
 * The URL form stays on the page above the review, so importing a second page
 * is one submission rather than a navigation. `draftId` keys the review form,
 * so that second page starts from its own parse instead of merging into the
 * edits made to the first.
 *
 * The "All recipes · Type one in instead" line that closed this screen is gone
 * (SPEC.md §3.3): Recipes is in the shell's navigation, and "Type one in
 * instead" is the page header's action now.
 */
export function ImportFlow({ catalog }: { catalog: readonly string[] }) {
  const [state, action, pending] = useActionState(importRecipeAction, undefined);
  // Controlled, because React resets a form once its action returns — and a
  // failed import that also wiped the address the user pasted would make them
  // find it again to read the reason it failed.
  const [url, setUrl] = useState("");
  const draft = state?.draft;

  return (
    <>
      <Card className="mb-8">
        <form action={action} className="flex flex-col gap-4">
          <Field
            id="url"
            label="Recipe page address"
            hint="Only pages that publish their recipe as schema.org markup can be imported — most recipe sites do. Nothing is saved until you confirm it below."
            error={state?.message}
          >
            <input
              id="url"
              name="url"
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
              className={controlClass}
              {...describedBy("url", { hint: true, error: state?.message })}
            />
          </Field>

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Fetching…" : draft === undefined ? "Fetch recipe" : "Fetch another"}
          </Button>
        </form>
      </Card>

      {draft !== undefined && (
        <Section
          title="Check this before saving"
          description={
            <>
              Read off <q className="wrap-anywhere">{draft.sourceUrl}</q>. Every line below is a
              guess at what the page meant — map each one to an ingredient you already have, or
              leave the name as it is to add it to your catalog. Nothing is saved until you press
              save.
            </>
          }
        >
          <RecipeForm key={state?.draftId} catalog={catalog} initial={draft} />
        </Section>
      )}
    </>
  );
}
