import { listIngredients } from "@/db/queries/ingredients";
import { requireScope } from "@/lib/auth/session";

import { ImportFlow } from "./import-flow";

/**
 * Import a recipe from a URL (SPEC.md §3).
 *
 * The catalog handed down is this household's and only the names — it is the
 * suggestion list the review screen matches parsed lines against, and the
 * ingredient ids a saved recipe is written with are resolved server-side from
 * the confirmed names, never taken from the browser.
 */
export default async function ImportRecipePage() {
  const scope = await requireScope();
  const catalog = await listIngredients(scope);

  return (
    <main>
      <h1>Import a recipe</h1>
      <ImportFlow catalog={catalog.map((row) => row.name)} />
    </main>
  );
}
