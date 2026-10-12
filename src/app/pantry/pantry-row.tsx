"use client";

import { useActionState } from "react";

import { removePantryItemAction, updatePantryItemAction } from "@/app/actions/pantry";
import { FormMessage } from "@/app/_components/fields";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";

import { AmountFields } from "./fields";

/**
 * One line of the pantry, with its amount editable in place.
 *
 * Both forms carry the row id in a hidden field, which is the client telling
 * the server *which* row to act on — nothing else about the row is submitted.
 * The action re-reads it under the session's scope, so a hand-edited id reaches
 * a query that cannot see another household's rows (SPEC.md §4).
 */

export type PantryListItem = {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitId: string;
  readonly densityGPerMl: number | null;
};

export function PantryRow({ item }: { item: PantryListItem }) {
  const [updateState, update, saving] = useActionState(updatePantryItemAction, undefined);
  const [removeState, remove, removing] = useActionState(removePantryItemAction, undefined);

  return (
    <Card as="li" className="flex flex-col gap-3">
      <div>
        {/* h3 under the page's "On the shelf" h2, so a screen reader can jump item to item. */}
        <h3 className="font-semibold text-ink">{item.name}</h3>
        <p className="text-sm text-ink-muted">
          {item.densityGPerMl === null
            ? "no density — weight/volume comparisons report “can’t verify”"
            : `${item.densityGPerMl} g/mL`}
        </p>
      </div>

      <FormMessage state={updateState} />
      <FormMessage state={removeState} />

      {/*
        Two forms side by side, because forms do not nest. On a phone the
        update form takes the whole width — amount and unit share a row, Save
        takes the next — and Remove wraps under it rather than squeezing the
        inputs beside it. From `sm` up it is one line.
      */}
      <div className="flex flex-wrap items-end gap-3">
        <form
          action={update}
          className="grid w-full grid-cols-2 items-end gap-3 sm:w-auto sm:flex-1 sm:grid-cols-3"
        >
          <input type="hidden" name="id" value={item.id} />
          <AmountFields
            idPrefix={item.id}
            defaultQuantity={String(item.quantity)}
            defaultUnitId={item.unitId}
            fieldErrors={updateState?.fieldErrors}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={saving}
            className="col-span-2 sm:col-span-1"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>

        <form action={remove}>
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit" variant="ghost" disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </Button>
        </form>
      </div>
    </Card>
  );
}
