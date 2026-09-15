import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AmountFields, DensityField } from "./fields";

/**
 * The pantry's controls, which since SPEC.md §3.6 sit on `ui/field.tsx`.
 *
 * Same join as `_components/fields.test.tsx` guards, and one more thing these
 * have that the auth fields do not: `/pantry` renders `AmountFields` once per
 * row, so every id on them is derived from a caller-supplied prefix. Two rows
 * sharing an id would give one row's label the other row's input.
 */

/** Ids an `aria-describedby` promises that no element in the markup carries. */
function danglingDescriptions(markup: string): readonly string[] {
  return [...markup.matchAll(/aria-describedby="([^"]*)"/g)]
    .flatMap((match) => (match[1] ?? "").split(" "))
    .filter((id) => id !== "" && !markup.includes(`id="${id}"`));
}

describe("the density field", () => {
  it("describes itself by the hint it renders", () => {
    // The hint is the only place the app explains that a blank density makes a
    // comparison report "can't verify" rather than missing, so it is the one
    // hint in the app it would most matter to lose.
    const markup = renderToStaticMarkup(<DensityField />);

    expect(danglingDescriptions(markup)).toEqual([]);
    expect(markup).toContain('id="densityGPerMl-hint"');
  });

  it("keeps describing the hint once it also has an error", () => {
    const markup = renderToStaticMarkup(<DensityField error="Enter a number above zero" />);

    expect(danglingDescriptions(markup)).toEqual([]);
    expect(markup).toContain('aria-describedby="densityGPerMl-hint densityGPerMl-error"');
  });

  it("stays optional, because blank is a real answer", () => {
    expect(renderToStaticMarkup(<DensityField />)).not.toContain("required");
  });
});

describe("the amount fields", () => {
  it("derives every id from the row they belong to", () => {
    const markup = renderToStaticMarkup(<AmountFields idPrefix="row-1" />);

    expect(markup).toContain('id="row-1-quantity"');
    expect(markup).toContain('id="row-1-unit"');
    expect(markup).toContain('for="row-1-quantity"');
  });

  it("points each error at the control it belongs to", () => {
    const markup = renderToStaticMarkup(
      <AmountFields
        idPrefix="row-1"
        fieldErrors={{ quantity: "Enter a number above zero", unitId: "Pick a unit" }}
      />,
    );

    expect(danglingDescriptions(markup)).toEqual([]);
    expect(markup).toContain('aria-describedby="row-1-quantity-error"');
    expect(markup).toContain('aria-describedby="row-1-unit-error"');
  });
});
