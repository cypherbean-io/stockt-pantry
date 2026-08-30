"use client";

import { useActionState, useState } from "react";

import { addPantryItemAction } from "@/app/actions/pantry";
import { Field, FormMessage } from "@/app/_components/fields";
import { NEW_INGREDIENT } from "@/lib/pantry/entry";

import { AmountFields, DensityField, FieldError } from "./fields";

/**
 * Put something on the shelf.
 *
 * The ingredient is either one already in the household's catalog or a new
 * entry named here. A household starts with an empty catalog, so the second
 * path is what makes the first one reachable at all (SPEC.md §6, step 3).
 *
 * The name and density inputs are only rendered when they apply — a hidden
 * field that still submits is how a density edit would sneak in against an
 * existing entry, which v1 does not have a surface for (SPEC.md §2, Out). The
 * parser ignores them on that branch regardless; this keeps the two agreeing.
 */

export type CatalogOption = { readonly id: string; readonly name: string };

export function AddPantryItemForm({ catalog }: { catalog: readonly CatalogOption[] }) {
  const [state, action, pending] = useActionState(addPantryItemAction, undefined);
  const [choice, setChoice] = useState<string>(catalog[0]?.id ?? NEW_INGREDIENT);

  const creating = choice === NEW_INGREDIENT;
  const fieldErrors = state?.fieldErrors;

  return (
    <form action={action}>
      <FormMessage state={state} />

      <p style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label htmlFor="ingredientId">Ingredient</label>
        <select
          id="ingredientId"
          name="ingredientId"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          aria-describedby={
            fieldErrors?.ingredientId === undefined ? undefined : "ingredientId-error"
          }
          aria-invalid={fieldErrors?.ingredientId === undefined ? undefined : true}
        >
          {catalog.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
          <option value={NEW_INGREDIENT}>Add a new ingredient…</option>
        </select>
        <FieldError id="ingredientId" error={fieldErrors?.ingredientId} />
      </p>

      {creating && (
        <>
          <Field
            label="New ingredient name"
            name="ingredientName"
            autoComplete="off"
            error={fieldErrors?.ingredientName}
          />
          <DensityField error={fieldErrors?.densityGPerMl} />
        </>
      )}

      <AmountFields idPrefix="add" fieldErrors={fieldErrors} />

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save to pantry"}
      </button>

      <p>
        <small>
          One row per ingredient: saving something already on the shelf replaces its amount
          rather than adding to it.
        </small>
      </p>
    </form>
  );
}
