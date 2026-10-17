"use client";

import { useActionState, useState } from "react";

import { addPantryItemAction } from "@/app/actions/pantry";
import { Field, FormMessage } from "@/app/_components/fields";
import { Button } from "@/app/_components/ui/button";
import { controlClass, describedBy, Field as FieldShell } from "@/app/_components/ui/field";
import { NEW_INGREDIENT } from "@/lib/pantry/entry";

import { AmountFields, DensityField } from "./fields";

/**
 * Put something on the shelf.
 *
 * The ingredient is either one already in the household's catalog or a new
 * entry named here. A household starts with an empty catalog, so the second
 * path is what makes the first one reachable at all (SPEC.md §6, step 3).
 *
 * The name and density inputs are only rendered when they apply — a hidden
 * field that still submits is how a density edit would sneak in against an
 * existing entry, which has its own deliberate form on the entry's pantry row.
 * The parser ignores them on that branch regardless; this keeps the two
 * agreeing.
 *
 * Two columns from `sm` up: the ingredient on a row of its own, then the new
 * entry's name beside its density, then the amount beside its unit — each
 * pair is one question, so it reads as one line.
 */

export type CatalogOption = { readonly id: string; readonly name: string };

export function AddPantryItemForm({ catalog }: { catalog: readonly CatalogOption[] }) {
  const [state, action, pending] = useActionState(addPantryItemAction, undefined);
  const [choice, setChoice] = useState<string>(catalog[0]?.id ?? NEW_INGREDIENT);

  const creating = choice === NEW_INGREDIENT;
  const fieldErrors = state?.fieldErrors;

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldShell id="ingredientId" label="Ingredient" error={fieldErrors?.ingredientId}>
            <select
              id="ingredientId"
              name="ingredientId"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className={controlClass}
              {...describedBy("ingredientId", { error: fieldErrors?.ingredientId })}
            >
              {catalog.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
              <option value={NEW_INGREDIENT}>Add a new ingredient…</option>
            </select>
          </FieldShell>
        </div>

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
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save to pantry"}
        </Button>
        <p className="max-w-prose text-sm text-ink-muted">
          One row per ingredient: saving something already on the shelf replaces its amount rather
          than adding to it.
        </p>
      </div>
    </form>
  );
}
