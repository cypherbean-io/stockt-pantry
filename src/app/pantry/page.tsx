import { listIngredients } from "@/db/queries/ingredients";
import { listPantryWithIngredients } from "@/db/queries/pantry";
import { requireScope } from "@/lib/auth/session";

import { PantryScreen } from "./pantry-screen";

/**
 * The household's pantry (SPEC.md §2, "Pantry inventory").
 *
 * Both queries take the scope from `requireScope()`, which derives it from the
 * session row. There is no household id in this URL and no way to ask for
 * another one — the check lives here, next to the data, rather than in a
 * layout that would not re-run on every navigation.
 */
export default async function PantryPage() {
  const scope = await requireScope();

  const [stocked, catalog] = await Promise.all([
    listPantryWithIngredients(scope),
    listIngredients(scope),
  ]);

  return (
    <PantryScreen
      items={stocked.map(({ item, ingredient }) => ({
        id: item.id,
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity: item.quantity,
        unitId: item.unitId,
        densityGPerMl: ingredient.densityGPerMl,
      }))}
      catalog={catalog.map(({ id, name }) => ({ id, name }))}
    />
  );
}
