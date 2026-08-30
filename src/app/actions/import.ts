"use server";

import { randomUUID } from "node:crypto";

import { requireScope } from "@/lib/auth/session";
import type { ImportDraft } from "@/lib/recipes/import-draft";
import { importRecipeFromUrl } from "@/lib/recipes/service";

/**
 * Phase one of a URL import (SPEC.md §3): hand the browser a draft to review,
 * having written nothing.
 *
 * Next.js treats this as a public endpoint — reachable by anyone who can POST —
 * so it calls `requireScope()` for itself. That is not only about the catalog
 * the flow reads: an unauthenticated server-side fetcher is an open proxy
 * wearing this deployment's source address, and the SSRF guard in
 * `fetch-page.ts` narrows what that is worth rather than making it free.
 */

export type ImportFormState =
  | {
      readonly message?: string;
      readonly draft?: ImportDraft;
      /**
       * Distinguishes one import attempt from the next, so the review form
       * remounts rather than merging a newly fetched page into the edits made
       * to the last one. Nothing is stored under it — it lives for one round
       * trip and is never written anywhere.
       */
      readonly draftId?: string;
    }
  | undefined;

export async function importRecipeAction(
  state: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const scope = await requireScope();

  const result = await importRecipeFromUrl(scope, formData.get("url"));
  if (!result.ok) {
    // Any draft already on the screen survives the failure, `draftId` included:
    // dropping it would throw away the review the user is part-way through
    // because a *second*, unrelated address did not fetch. Keeping the same id
    // is what keeps their edits — the review form only re-seeds when it changes.
    return { message: result.message, draft: state?.draft, draftId: state?.draftId };
  }

  return { draft: result.draft, draftId: randomUUID() };
}
