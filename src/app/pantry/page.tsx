import Link from "next/link";

import { listIngredients } from "@/db/queries/ingredients";
import { listPantryWithIngredients } from "@/db/queries/pantry";
import { requireScope } from "@/lib/auth/session";

import { AddPantryItemForm } from "./add-item-form";
import { PantryRow } from "./pantry-row";

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
    <main>
      <h1>Pantry</h1>
      <p>
        What this household has on the shelf. <Link href="/household">Household</Link>
      </p>

      <h2>Add an item</h2>
      <AddPantryItemForm catalog={catalog.map(({ id, name }) => ({ id, name }))} />

      <h2>On the shelf</h2>
      {stocked.length === 0 ? (
        <p>Nothing yet. Add the first thing above.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {stocked.map(({ item, ingredient }) => (
            <PantryRow
              /*
                Keyed on the amount as well as the id so that saving a change
                remounts the row's inputs. An uncontrolled input keeps whatever
                the user last typed even after its `defaultValue` changes, so
                without this the field can go on showing a value the row behind
                it no longer holds.
              */
              key={`${item.id}:${item.quantity}:${item.unitId}`}
              item={{
                id: item.id,
                name: ingredient.name,
                quantity: item.quantity,
                unitId: item.unitId,
                densityGPerMl: ingredient.densityGPerMl,
              }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
