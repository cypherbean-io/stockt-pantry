"use client";

import { useActionState, useRef, useState } from "react";

import { createRecipeAction } from "@/app/actions/recipes";
import { HalfCircleIcon, PlusIcon } from "@/app/_components/icons";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import {
  controlClass,
  describedBy,
  Field,
  FieldError,
  FormMessage,
} from "@/app/_components/ui/field";
import { Section } from "@/app/_components/ui/section";
import { UNITS } from "@/lib/matching/units";
import type { ImportDraft } from "@/lib/recipes/import-draft";
import { MAX_SERVINGS } from "@/lib/recipes/form";

/**
 * The recipe form, shared by manual entry (`/recipes/new`) and by the
 * review-and-confirm step of a URL import (`/recipes/import`).
 *
 * One component for both because they are the same form: an import's review
 * screen is this, pre-filled from a parsed page and annotated with what the
 * parser was unsure about. `initial` is what makes it the second one; without
 * it the form starts empty.
 *
 * The ingredient rows are repeated inputs of the same four names, so the server
 * reads them with `getAll` and pairs them by position. That only holds if every
 * row submits all four, which is why a row renders its density input even when
 * it is empty — see `parseRecipeForm`, which rejects a submission whose columns
 * are different lengths rather than guessing at the pairing.
 *
 * The inputs are controlled rather than uncontrolled: React resets a form after
 * its action runs, and a validation error that emptied a half-written recipe
 * would be worse than the error. That also means the seed from `initial` is
 * read once, at mount — the import page gives this component a `key` per import
 * so a second one starts over rather than merging into the first.
 */

const UNIT_OPTIONS = Object.entries(UNITS).map(([id, unit]) => ({ id, label: unit.name }));

const CATALOG_LIST_ID = "ingredient-catalog";

type Row = {
  readonly key: number;
  readonly name: string;
  readonly quantity: string;
  readonly unitId: string;
  readonly density: string;
  /** Import only: the page's own text for this line, and how well it parsed. */
  readonly raw?: string;
  readonly needsChecking?: boolean;
};

function blankRow(key: number): Row {
  return { key, name: "", quantity: "", unitId: "g", density: "" };
}

/**
 * The parsed lines, as form rows.
 *
 * A line the parser could not read keeps its empty quantity and its unset unit
 * rather than being given plausible ones — the row is unsubmittable until the
 * user fills it in, which is the point (SPEC.md §5: an ambiguous line must
 * require explicit confirmation, not a silent default).
 */
function draftRows(draft: ImportDraft): readonly Row[] {
  return draft.lines.map((line, key) => ({
    key,
    name: line.name,
    quantity: line.quantity,
    unitId: line.unitId,
    density: "",
    raw: line.raw,
    needsChecking: line.confidence !== "high",
  }));
}

/**
 * What the import review flags for a second look. `--status-warn` with its own
 * ink, because it is the "check this" colour everywhere else in the app, and
 * the half-circle glyph beside it so the colour is not carrying it alone
 * (SPEC.md §3.5).
 */
const WARNING =
  "flex items-start gap-2 rounded-control bg-status-warn px-3 py-2 text-sm text-status-warn-ink";

export function RecipeForm({
  catalog,
  initial,
}: {
  catalog: readonly string[];
  /** Present on the import review screen; absent for manual entry. */
  initial?: ImportDraft;
}) {
  const [state, action, pending] = useActionState(createRecipeAction, undefined);

  const [name, setName] = useState(initial?.name ?? "");
  const [baseServings, setBaseServings] = useState(initial?.baseServings ?? "4");
  const [steps, setSteps] = useState(initial?.steps ?? "");
  const [rows, setRows] = useState<readonly Row[]>(() =>
    initial === undefined ? [blankRow(0), blankRow(1)] : draftRows(initial),
  );
  const nextKey = useRef(rows.length);

  const update = (key: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows((current) => [...current, blankRow(nextKey.current++)]);
  };

  const removeRow = (key: number) => {
    // Never down to zero: the server requires at least one line, and a form
    // that can reach a state it cannot submit is a trap.
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.key !== key)));
  };

  const errorFor = (field: string) => state?.fieldErrors?.[field];

  return (
    <form action={action} className="flex flex-col gap-6">
      <FormMessage message={state?.message} />

      {/* The page an import came from, so the saved recipe records it
          (SPEC.md §3). Hidden, so it is request input by the time it comes back
          — `parseRecipeForm` re-checks the scheme rather than trusting it. */}
      {initial !== undefined && <input type="hidden" name="sourceUrl" value={initial.sourceUrl} />}
      {/* A form-level message: the field it is about is hidden, so there is
          nothing on screen to put it beside. */}
      <FormMessage message={errorFor("sourceUrl")} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field id="name" label="Recipe name" error={errorFor("name")}>
            <input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className={controlClass}
              {...describedBy("name", { error: errorFor("name") })}
            />
          </Field>
        </div>

        <Field
          id="baseServings"
          label="Serves"
          hint="How many the quantities below are written for. You can rescale later."
          error={errorFor("baseServings")}
        >
          <input
            id="baseServings"
            name="baseServings"
            type="number"
            min={1}
            max={MAX_SERVINGS}
            step={1}
            value={baseServings}
            onChange={(event) => setBaseServings(event.target.value)}
            required
            className={controlClass}
            {...describedBy("baseServings", { hint: true, error: errorFor("baseServings") })}
          />
        </Field>
      </div>

      {initial?.servingsStated === false && (
        <p className={WARNING}>
          <HalfCircleIcon className="mt-1 shrink-0" />
          <span>
            <strong className="font-semibold">The page did not say how many this serves.</strong>{" "}
            This is a guess — correct it, or every rescaling of this recipe will be off by the same
            factor.
          </span>
        </p>
      )}

      <Section
        title="Ingredients"
        description="A name that is not already in the catalog is added to it. Density is only used when that happens, and only matters for converting between weight and volume."
      >
        <datalist id={CATALOG_LIST_ID}>
          {catalog.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>

        <div className="flex flex-col gap-3">
          <FormMessage message={errorFor("lines")} />

          {/*
            A list of cards rather than a <table>: every row is a form, and a
            five-column form does not fit a phone (SPEC.md §3.6). Two columns
            below `sm`, one line from `sm` up, where density gets as much room
            as the name so its "g/mL, optional" placeholder is not clipped. Each control has a visible
            label *and* keeps its numbered `aria-label`, because "Quantity"
            read out eight times does not say which row it is in; the visible
            word is inside the spoken name, so voice control still finds it.
          */}
          <ol className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const id = `ingredient-${row.key}`;

              return (
                <Card as="li" key={row.key} className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-12">
                    <div className="col-span-2 sm:col-span-3">
                      <Field id={`${id}-name`} label="Ingredient">
                        <input
                          id={`${id}-name`}
                          name="ingredientName"
                          aria-label={`Ingredient ${index + 1} name`}
                          list={CATALOG_LIST_ID}
                          value={row.name}
                          onChange={(event) => update(row.key, { name: event.target.value })}
                          required
                          className={controlClass}
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field id={`${id}-quantity`} label="Quantity">
                        <input
                          id={`${id}-quantity`}
                          name="ingredientQuantity"
                          aria-label={`Ingredient ${index + 1} quantity`}
                          type="number"
                          min={0}
                          step="any"
                          value={row.quantity}
                          onChange={(event) => update(row.key, { quantity: event.target.value })}
                          required
                          className={controlClass}
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field id={`${id}-unit`} label="Unit">
                        <select
                          id={`${id}-unit`}
                          name="ingredientUnit"
                          aria-label={`Ingredient ${index + 1} unit`}
                          value={row.unitId}
                          onChange={(event) => update(row.key, { unitId: event.target.value })}
                          required
                          className={controlClass}
                        >
                          {/* A parsed line with no readable unit gets no preselected
                              one. The empty value plus `required` is what makes the row
                              unsubmittable until the user picks — `parseRecipeForm`
                              rejects it too, since the browser is not the guard. */}
                          {row.unitId === "" && <option value="">Pick a unit</option>}
                          {UNIT_OPTIONS.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field id={`${id}-density`} label="Density">
                        <input
                          id={`${id}-density`}
                          name="ingredientDensity"
                          aria-label={`Ingredient ${index + 1} density in grams per millilitre`}
                          type="number"
                          min={0}
                          step="any"
                          placeholder="g/mL, optional"
                          value={row.density}
                          onChange={(event) => update(row.key, { density: event.target.value })}
                          className={controlClass}
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Button
                        variant="ghost"
                        onClick={() => removeRow(row.key)}
                        disabled={rows.length === 1}
                        aria-label={`Remove ingredient ${index + 1}`}
                        className="w-full"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {/* Import only: what the page actually said, so the user is
                      checking the parse rather than trusting it. */}
                  {row.raw !== undefined && (
                    <p className="text-sm text-ink-muted wrap-anywhere">
                      From the page: <q>{row.raw}</q>
                    </p>
                  )}
                  {row.needsChecking === true && (
                    <p role="alert" className={WARNING}>
                      <HalfCircleIcon className="mt-1 shrink-0" />
                      <span>This line did not read cleanly — check the quantity and unit.</span>
                    </p>
                  )}
                  <FieldError id={`line-${index}`} error={errorFor(`line-${index}`)} />
                </Card>
              );
            })}
          </ol>

          <Button variant="secondary" onClick={addRow} className="self-start">
            <PlusIcon className="shrink-0" />
            Add another ingredient
          </Button>
        </div>
      </Section>

      <Section title="Steps">
        <Field id="steps" label="One step per line" error={errorFor("steps")}>
          <textarea
            id="steps"
            name="steps"
            rows={8}
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            className={controlClass}
            {...describedBy("steps", { error: errorFor("steps") })}
          />
        </Field>
      </Section>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save recipe"}
      </Button>
    </form>
  );
}
