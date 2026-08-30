"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { importRecipeAction } from "@/app/actions/import";

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
 * The URL form stays on the page underneath the review, so importing a second
 * page is one submission rather than a navigation. `draftId` keys the review
 * form, so that second page starts from its own parse instead of merging into
 * the edits made to the first.
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
      <form action={action}>
        <p style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <label htmlFor="url">Recipe page address</label>
          <input
            id="url"
            name="url"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
            aria-invalid={state?.message === undefined ? undefined : true}
          />
          <small>
            Only pages that publish their recipe as schema.org markup can be imported — most
            recipe sites do. Nothing is saved until you confirm it below.
          </small>
          {state?.message !== undefined && (
            <small role="alert" style={{ color: "#b00020" }}>
              {state.message}
            </small>
          )}
        </p>

        <button type="submit" disabled={pending}>
          {pending ? "Fetching…" : draft === undefined ? "Fetch recipe" : "Fetch another"}
        </button>
      </form>

      {draft !== undefined && (
        <>
          <h2>Check this before saving</h2>
          <p>
            <small>
              Read off <q>{draft.sourceUrl}</q>. Every line below is a guess at what the page
              meant — map each one to an ingredient you already have, or leave the name as it is
              to add it to your catalog. Nothing is saved until you press save.
            </small>
          </p>

          <RecipeForm key={state?.draftId} catalog={catalog} initial={draft} />
        </>
      )}

      <p>
        <Link href="/recipes">All recipes</Link> ·{" "}
        <Link href="/recipes/new">Type one in instead</Link>
      </p>
    </>
  );
}
