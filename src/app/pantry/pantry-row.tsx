"use client";

import { useActionState } from "react";

import { removePantryItemAction, updatePantryItemAction } from "@/app/actions/pantry";
import { FormMessage } from "@/app/_components/fields";

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

const ROW_STYLE = {
  borderTop: "1px solid #ddd",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: "1rem",
  padding: "0.75rem 0",
} as const;

const FORM_STYLE = { display: "flex", alignItems: "flex-end", gap: "0.5rem" } as const;

export function PantryRow({ item }: { item: PantryListItem }) {
  const [updateState, update, saving] = useActionState(updatePantryItemAction, undefined);
  const [removeState, remove, removing] = useActionState(removePantryItemAction, undefined);

  return (
    <li style={ROW_STYLE}>
      {/* A div, not a span: `FormMessage` renders a paragraph. */}
      <div style={{ flexBasis: "100%" }}>
        <strong>{item.name}</strong>{" "}
        <small>
          {item.densityGPerMl === null
            ? "no density — weight/volume comparisons report “can’t verify”"
            : `${item.densityGPerMl} g/mL`}
        </small>
        <FormMessage state={updateState} />
        <FormMessage state={removeState} />
      </div>

      <form action={update} style={FORM_STYLE}>
        <input type="hidden" name="id" value={item.id} />
        <AmountFields
          idPrefix={item.id}
          defaultQuantity={String(item.quantity)}
          defaultUnitId={item.unitId}
          fieldErrors={updateState?.fieldErrors}
        />
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <form action={remove}>
        <input type="hidden" name="id" value={item.id} />
        <button type="submit" disabled={removing}>
          {removing ? "Removing…" : "Remove"}
        </button>
      </form>
    </li>
  );
}
