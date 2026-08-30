import "server-only";

import { findOrCreateIngredient, listIngredients } from "@/db/queries/ingredients";
import { createRecipe, deleteRecipe } from "@/db/queries/recipes";
import type { HouseholdScope } from "@/db/scope";
import {
  describeFailure,
  fetchPage,
  redactUrlForLog,
  type FetchPageDeps,
} from "@/lib/import/fetch-page";
import { describeExtractFailure, extractRecipe } from "@/lib/import/jsonld";

import { MAX_URL_LENGTH, type RecipeDraft } from "./form";
import { buildImportDraft, type ImportDraft } from "./import-draft";

/**
 * The recipe flows: import from a URL, save a confirmed recipe, delete one.
 *
 * Nothing here touches `next/headers`, for the same reason `pantry/service.ts`
 * does not: each flow takes a `HouseholdScope` and returns a result, which is
 * what makes the whole path testable against a real database with no request
 * context — `src/db/recipe-import.db.test.ts`.
 *
 * The scope is the only source of the household id. No parameter here names
 * one, so no submission can point a read or a write at another tenant
 * (SPEC.md §4).
 */

export type ImportResult =
  | { readonly ok: true; readonly draft: ImportDraft }
  | { readonly ok: false; readonly message: string };

export type SaveResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

/**
 * Safe to log only because every query these flows call — `createRecipe`,
 * `findOrCreateIngredient`, `deleteRecipe` — routes its driver errors through
 * `src/db/redact.ts` first, so what arrives carries the SQLSTATE and constraint
 * name and nothing else. The unredacted message quotes the bound parameters,
 * which here are the whole recipe; SPEC.md §4 keeps that out of the logs. A new
 * query called from here has to be guarded the same way before it lands in this.
 */
function reportFailure(what: string, error: unknown): void {
  console.error(`${what} failed:`, error instanceof Error ? error.message : "unknown error");
}

/**
 * SPEC.md §4: the import fetcher logs its target URL and the outcome —
 * including "rejected as a private address", which is the line that shows the
 * guard fired — and never the page it fetched. The resolved address stays out
 * of it: the reason code is what makes the behaviour debuggable, and the
 * address is the part that would map someone's internal network into a log.
 *
 * The URL goes through `redactUrlForLog` first. SPEC.md §4 sanctions logging
 * the target, but a pasted URL can carry a password in its userinfo or a token
 * in its query — and the rejection of a URL *for* carrying credentials is
 * exactly the outcome this logs. `JSON.stringify` on top of that is not
 * decoration either: quoting caller-supplied text is what stops someone forging
 * a second log line by pasting one into the address box.
 */
function logOutcome(url: string, outcome: string): void {
  console.info(`Recipe import: ${outcome} for ${JSON.stringify(redactUrlForLog(url))}`);
}

/**
 * Phase one of an import (SPEC.md §3 steps 1–4): fetch, extract, parse — and
 * persist nothing.
 *
 * That is the whole point of the two-phase flow. This function writes no rows,
 * so a failure anywhere inside it cannot leave a half-imported recipe behind:
 * there is nothing to leave. The draft goes back to the browser, the user
 * confirms it, and `saveRecipeDraft` is what writes.
 *
 * `deps` exists so the tests can stand in for DNS and the network. Production
 * passes nothing and gets the real ones.
 */
export async function importRecipeFromUrl(
  scope: HouseholdScope,
  rawUrl: unknown,
  deps: FetchPageDeps = {},
): Promise<ImportResult> {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";

  if (url === "") {
    return { ok: false, message: "Paste the address of a recipe page." };
  }
  // Bounded before the fetcher sees it. `fetchPage` would reject it too, but a
  // megabyte of "URL" has no business being resolved, logged, or echoed back.
  if (url.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      message: `That address is too long (${MAX_URL_LENGTH} characters at most).`,
    };
  }

  const fetched = await fetchPage(url, deps);
  if (!fetched.ok) {
    const { failure } = fetched;
    logOutcome(
      url,
      failure.reason === "blocked-url"
        ? `rejected (${failure.rejection.reason})`
        : `failed (${failure.reason})`,
    );
    // `describeFailure`, not the failure itself: the rejection carries the
    // address the host resolved to, and echoing that would turn the import form
    // into a way to map the internal network one hostname at a time.
    return { ok: false, message: describeFailure(failure) };
  }

  const extracted = extractRecipe(fetched.page.html);
  if (!extracted.ok) {
    logOutcome(fetched.page.finalUrl, `failed (${extracted.failure.reason})`);
    return { ok: false, message: describeExtractFailure(extracted.failure) };
  }

  // Scoped, so the suggestions on the review screen can only ever be this
  // household's own catalog (SPEC.md §5).
  const catalog = await listIngredients(scope);

  // The URL recorded is where the body actually came from rather than what was
  // typed: a redirect chain that ended somewhere else should say so.
  const built = buildImportDraft(
    extracted.recipe,
    fetched.page.finalUrl,
    catalog.map((row) => row.name),
  );
  if (!built.ok) {
    logOutcome(fetched.page.finalUrl, "failed (too large for this app)");
    return { ok: false, message: built.message };
  }

  logOutcome(fetched.page.finalUrl, "parsed, awaiting confirmation");
  return { ok: true, draft: built.draft };
}

/**
 * Phase two: write a recipe the user has confirmed — the end of an import
 * (SPEC.md §3 step 5) and of manual entry alike.
 *
 * Each confirmed name becomes a catalog entry in *this* household, existing or
 * new, so the ingredient ids the recipe is written with are never
 * client-supplied. The density is only consulted when a row is actually
 * created.
 */
export async function saveRecipeDraft(
  scope: HouseholdScope,
  draft: RecipeDraft,
): Promise<SaveResult> {
  try {
    const ingredients = await Promise.all(
      draft.lines.map(async (line) => ({
        ingredientId: (
          await findOrCreateIngredient(scope, {
            name: line.name,
            densityGPerMl: line.densityGPerMl,
          })
        ).id,
        quantity: line.quantity,
        unitId: line.unitId,
      })),
    );

    const saved = await createRecipe(scope, {
      name: draft.name,
      baseServings: draft.baseServings,
      steps: draft.steps,
      // Set when the review screen posted one back, absent for a recipe typed
      // in by hand. `parseRecipeForm` has already held it to http/https — the
      // fetch that produced it is over by the time it comes back.
      sourceUrl: draft.sourceUrl,
      ingredients,
    });

    return { ok: true, id: saved.id };
  } catch (error) {
    reportFailure("Saving a recipe", error);
    // Deliberately not "nothing was written". The recipe and its lines are
    // written in one transaction, so *that* is all-or-nothing — but the catalog
    // entries above are resolved first, each in its own, so a failure part-way
    // through can leave new ingredients behind. They are entries the user asked
    // for by name, and re-submitting reuses them.
    return { ok: false, message: "Could not save that recipe. It was not added to your recipes." };
  }
}

/**
 * Delete one of the household's own recipes.
 *
 * The outcome is not reported: a scoped delete answers "no such recipe" for
 * another household's id and for a malformed one alike, and telling the caller
 * which it was would be an oracle for which ids exist.
 */
export async function removeRecipe(scope: HouseholdScope, id: unknown): Promise<void> {
  if (typeof id !== "string") return;

  try {
    await deleteRecipe(scope, id);
  } catch (error) {
    reportFailure("Deleting a recipe", error);
  }
}
