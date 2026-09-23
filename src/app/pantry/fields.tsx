import { controlClass, describedBy, Field } from "@/app/_components/ui/field";
import type { FieldErrors } from "@/lib/forms";
import { UNITS, type UnitKey } from "@/lib/matching/units";

/**
 * The form controls the pantry screens share.
 *
 * Separate from `@/app/_components/fields`, which the auth forms use: those are
 * required text inputs, and these are a number input with a decimal step, an
 * optional one, and a select over the unit table. Bending one component to
 * cover both would take more props than either form has fields.
 *
 * Both now sit on `ui/field.tsx` (SPEC.md §3.6), which is where the label,
 * hint, error and `aria-*` wiring they genuinely do share lives.
 */

/**
 * Re-exported because the pantry forms render errors for controls that are not
 * inside a `Field` — the ingredient picker on the add form is one. Same
 * component, same `${id}-error` contract.
 */
export { FieldError } from "@/app/_components/ui/field";

/**
 * Grouped by dimension so the list reads as three short ones rather than ten
 * flat entries, and derived from `UNITS` rather than listed again — a unit
 * added there should appear here without a second edit.
 */
const DIMENSIONS = ["mass", "volume", "count"] as const;

const DIMENSION_LABEL: Record<(typeof DIMENSIONS)[number], string> = {
  mass: "Mass",
  volume: "Volume",
  count: "Count",
};

const UNIT_GROUPS = DIMENSIONS.map((dimension) => ({
  dimension,
  // `Object.keys` widens to string[]; the keys of UNITS are exactly UnitKey.
  keys: (Object.keys(UNITS) as UnitKey[]).filter((key) => UNITS[key].dimension === dimension),
}));

/**
 * The (quantity, unit) pair (SPEC.md, Conventions: quantities are always a
 * value and a unit, never free text). Used by the add form and by every row's
 * inline edit, so the ids it generates are prefixed by the caller — a page
 * renders one of these per pantry item.
 */
export function AmountFields({
  idPrefix,
  defaultQuantity,
  defaultUnitId,
  fieldErrors,
}: {
  idPrefix: string;
  defaultQuantity?: string;
  defaultUnitId?: string;
  fieldErrors?: FieldErrors;
}) {
  const quantityId = `${idPrefix}-quantity`;
  const unitId = `${idPrefix}-unit`;
  const quantityError = fieldErrors?.quantity;
  const unitError = fieldErrors?.unitId;

  return (
    <>
      <Field id={quantityId} label="Amount" error={quantityError}>
        {/*
          `type="number"` rather than a text field on purpose: browsers submit
          it with a period decimal separator whatever the user's locale enters,
          so the server never has to guess whether "1,5" is one value or two.
        */}
        <input
          id={quantityId}
          name="quantity"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          defaultValue={defaultQuantity}
          required
          className={controlClass}
          {...describedBy(quantityId, { error: quantityError })}
        />
      </Field>

      <Field id={unitId} label="Unit" error={unitError}>
        <select
          id={unitId}
          name="unitId"
          defaultValue={defaultUnitId}
          required
          className={controlClass}
          {...describedBy(unitId, { error: unitError })}
        >
          {UNIT_GROUPS.map((group) => (
            <optgroup key={group.dimension} label={DIMENSION_LABEL[group.dimension]}>
              {group.keys.map((key) => (
                <option key={key} value={key}>
                  {UNITS[key].name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
    </>
  );
}

const DENSITY_HINT =
  "Only needed to compare a weight against a volume — 0.53 for flour, 0.85 for caster " +
  "sugar. Leave it blank and those comparisons report “can’t verify”.";

/**
 * Density, which is optional and stays optional.
 *
 * Leaving it blank is a real answer, not an omission: an ingredient with no
 * density makes a mass<->volume comparison report "can't verify" rather than
 * present or absent (SPEC.md §3), which is the honest outcome. Guessing a
 * number to fill the field in would be worse than leaving it empty.
 *
 * Which is why `describedBy` is told about the hint as well as the error: that
 * sentence is the only place the app explains the rule, and a description that
 * skipped it would hide it from anyone not reading the screen.
 */
export function DensityField({ error }: { error?: string }) {
  return (
    <Field id="densityGPerMl" label="Density in g/mL (optional)" hint={DENSITY_HINT} error={error}>
      <input
        id="densityGPerMl"
        name="densityGPerMl"
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        className={controlClass}
        {...describedBy("densityGPerMl", { hint: true, error })}
      />
    </Field>
  );
}
