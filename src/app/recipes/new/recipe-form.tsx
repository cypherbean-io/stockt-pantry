"use client";

import { useActionState, useRef, useState } from "react";

import { createRecipeAction } from "@/app/actions/recipes";
import { UNITS } from "@/lib/matching/units";
import { MAX_SERVINGS } from "@/lib/recipes/form";

/**
 * The ingredient rows are repeated inputs of the same four names, so the server
 * reads them with `getAll` and pairs them by position. That only holds if every
 * row submits all four, which is why a row renders its density input even when
 * it is empty — see `parseRecipeForm`, which rejects a submission whose columns
 * are different lengths rather than guessing at the pairing.
 *
 * The inputs are controlled rather than uncontrolled: React resets a form after
 * its action runs, and a validation error that emptied a half-written recipe
 * would be worse than the error.
 */

const UNIT_OPTIONS = Object.entries(UNITS).map(([id, unit]) => ({ id, label: unit.name }));

const CATALOG_LIST_ID = "ingredient-catalog";

type Row = {
  readonly key: number;
  readonly name: string;
  readonly quantity: string;
  readonly unitId: string;
  readonly density: string;
};

function blankRow(key: number): Row {
  return { key, name: "", quantity: "", unitId: "g", density: "" };
}

function Problem({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <small role="alert" style={{ color: "#b00020" }}>
      {message}
    </small>
  );
}

export function RecipeForm({ catalog }: { catalog: readonly string[] }) {
  const [state, action, pending] = useActionState(createRecipeAction, undefined);

  const [name, setName] = useState("");
  const [baseServings, setBaseServings] = useState("4");
  const [steps, setSteps] = useState("");
  const [rows, setRows] = useState<readonly Row[]>(() => [blankRow(0), blankRow(1)]);
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
    <form action={action}>
      {state?.message !== undefined && (
        <p role="alert" style={{ color: "#b00020" }}>
          {state.message}
        </p>
      )}

      <p style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label htmlFor="name">Recipe name</label>
        <input
          id="name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          aria-invalid={errorFor("name") === undefined ? undefined : true}
        />
        <Problem message={errorFor("name")} />
      </p>

      <p style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label htmlFor="baseServings">Serves</label>
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
          aria-invalid={errorFor("baseServings") === undefined ? undefined : true}
        />
        <small>How many the quantities below are written for. You can rescale later.</small>
        <Problem message={errorFor("baseServings")} />
      </p>

      <h2>Ingredients</h2>
      <p>
        <small>
          A name that is not already in the catalog is added to it. Density is only used when
          that happens, and only matters for converting between weight and volume.
        </small>
      </p>

      <datalist id={CATALOG_LIST_ID}>
        {catalog.map((entry) => (
          <option key={entry} value={entry} />
        ))}
      </datalist>

      <Problem message={errorFor("lines")} />

      <table>
        <thead>
          <tr>
            <th align="left">Ingredient</th>
            <th align="left">Quantity</th>
            <th align="left">Unit</th>
            <th align="left">Density (g/mL)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key}>
              <td>
                <input
                  name="ingredientName"
                  aria-label={`Ingredient ${index + 1} name`}
                  list={CATALOG_LIST_ID}
                  value={row.name}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                  required
                />
              </td>
              <td>
                <input
                  name="ingredientQuantity"
                  aria-label={`Ingredient ${index + 1} quantity`}
                  type="number"
                  min={0}
                  step="any"
                  value={row.quantity}
                  onChange={(event) => update(row.key, { quantity: event.target.value })}
                  required
                  style={{ width: "6rem" }}
                />
              </td>
              <td>
                <select
                  name="ingredientUnit"
                  aria-label={`Ingredient ${index + 1} unit`}
                  value={row.unitId}
                  onChange={(event) => update(row.key, { unitId: event.target.value })}
                >
                  {UNIT_OPTIONS.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  name="ingredientDensity"
                  aria-label={`Ingredient ${index + 1} density in grams per millilitre`}
                  type="number"
                  min={0}
                  step="any"
                  placeholder="optional"
                  value={row.density}
                  onChange={(event) => update(row.key, { density: event.target.value })}
                  style={{ width: "6rem" }}
                />
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  disabled={rows.length === 1}
                  aria-label={`Remove ingredient ${index + 1}`}
                >
                  Remove
                </button>
                <Problem message={errorFor(`line-${index}`)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        <button type="button" onClick={addRow}>
          Add another ingredient
        </button>
      </p>

      <h2>Steps</h2>
      <p style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label htmlFor="steps">One step per line</label>
        <textarea
          id="steps"
          name="steps"
          rows={8}
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
        />
        <Problem message={errorFor("steps")} />
      </p>

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save recipe"}
      </button>
    </form>
  );
}
