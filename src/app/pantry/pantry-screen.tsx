import type { ReactElement } from "react";

import { PlusIcon } from "@/app/_components/icons";
import { Card } from "@/app/_components/ui/card";
import { EmptyState } from "@/app/_components/ui/empty-state";
import { PageHeader } from "@/app/_components/ui/page-header";
import { Section } from "@/app/_components/ui/section";

import { AddPantryItemForm, type CatalogOption } from "./add-item-form";
import { PantryRow, type PantryListItem } from "./pantry-row";

/**
 * What `/pantry` shows, given what `page.tsx` has already read. Split from the
 * page as `Header` is from `AppShell`, so the markup renders in a test without
 * a database or a request.
 */
export function PantryScreen({
  items,
  catalog,
}: {
  readonly items: readonly PantryListItem[];
  readonly catalog: readonly CatalogOption[];
}): ReactElement {
  return (
    <>
      {/* Recipes and Household moved to the shell's navigation (SPEC.md §3.3). */}
      <PageHeader title="Pantry" description="What this household has on the shelf." />

      <div className="flex flex-col gap-8">
        <Section title="Add an item">
          <Card>
            <AddPantryItemForm catalog={catalog} />
          </Card>
        </Section>

        <Section title="On the shelf">
          {items.length === 0 ? (
            // No action: the form that fills this is directly above it.
            <EmptyState icon={<PlusIcon />}>Nothing yet. Add the first thing above.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <PantryRow
                  /*
                    Keyed on the amount and density as well as the id so that
                    saving a change remounts the row's inputs. An uncontrolled
                    input keeps whatever the user last typed even after its
                    `defaultValue` changes, so without this the field can go on
                    showing a value the row behind it no longer holds.
                  */
                  key={`${item.id}:${item.quantity}:${item.unitId}:${item.densityGPerMl}`}
                  item={item}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
