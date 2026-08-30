import { describe, expect, it } from "vitest";

import {
  MAX_INGREDIENT_NAME_LENGTH,
  NEW_INGREDIENT,
  parsePantryAmount,
  parsePantryEntry,
  parsePantryItemId,
} from "./entry";

/**
 * Input rules for the pantry forms.
 *
 * Everything a browser sends is a string, and a server action is a public POST
 * endpoint (SPEC.md §4) — so these tests describe what happens to values no
 * form would produce as much as to values it would.
 */

const EXISTING_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** A well-formed submission against an ingredient already in the catalog. */
function existingEntry(overrides: Record<string, unknown> = {}) {
  return {
    ingredientId: EXISTING_ID,
    ingredientName: "",
    densityGPerMl: "",
    quantity: "500",
    unitId: "g",
    ...overrides,
  };
}

/** A well-formed submission that names a catalog entry to create. */
function newEntry(overrides: Record<string, unknown> = {}) {
  return {
    ingredientId: NEW_INGREDIENT,
    ingredientName: "Caster sugar",
    densityGPerMl: "",
    quantity: "2",
    unitId: "cup",
    ...overrides,
  };
}

describe("parsePantryEntry, choosing the ingredient", () => {
  it("takes a catalog id as a reference to an existing entry", () => {
    const parsed = parsePantryEntry(existingEntry());

    expect(parsed).toEqual({
      ok: true,
      value: {
        ingredient: { kind: "existing", id: EXISTING_ID },
        quantity: 500,
        unitId: "g",
      },
    });
  });

  it("takes the sentinel plus a name as a request to create an entry", () => {
    const parsed = parsePantryEntry(newEntry());

    expect(parsed).toEqual({
      ok: true,
      value: {
        ingredient: { kind: "new", name: "Caster sugar" },
        quantity: 2,
        unitId: "cup",
      },
    });
  });

  it("rejects a catalog id that is not a well-formed uuid", () => {
    // The column is `uuid`; handing Postgres anything else is SQLSTATE 22P02
    // and a driver error that must not escape (CLAUDE.md).
    const parsed = parsePantryEntry(existingEntry({ ingredientId: "' OR 1=1 --" }));

    expect(parsed).toEqual({ ok: false, errors: { ingredientId: expect.any(String) } });
  });

  it("rejects a submission that names no ingredient at all", () => {
    const parsed = parsePantryEntry(existingEntry({ ingredientId: "" }));

    expect(parsed.ok).toBe(false);
  });

  it("rejects a blank name when the sentinel asks for a new entry", () => {
    const parsed = parsePantryEntry(newEntry({ ingredientName: "   " }));

    expect(parsed).toEqual({ ok: false, errors: { ingredientName: expect.any(String) } });
  });

  it("trims the surrounding whitespace off a new ingredient's name", () => {
    const parsed = parsePantryEntry(newEntry({ ingredientName: "  Rolled oats \n" }));

    expect(parsed.ok && parsed.value.ingredient).toEqual({ kind: "new", name: "Rolled oats" });
  });

  it("rejects a name carrying a NUL, which Postgres cannot store in a text column", () => {
    // SQLSTATE 22021 rejects the whole statement, so this would escape as a 500
    // from a form rather than as a field error.
    const parsed = parsePantryEntry(newEntry({ ingredientName: "Fl\u0000our" }));

    expect(parsed).toEqual({ ok: false, errors: { ingredientName: expect.any(String) } });
  });

  it("rejects a name carrying an invisible formatting character", () => {
    // U+202E, a right-to-left override: it renders as something other than
    // what it is, which a catalog name has no reason to do.
    const parsed = parsePantryEntry(newEntry({ ingredientName: "Flo\u202Eur" }));

    expect(parsed).toEqual({ ok: false, errors: { ingredientName: expect.any(String) } });
  });

  it("rejects a name longer than the catalog allows", () => {
    const parsed = parsePantryEntry(
      newEntry({ ingredientName: "a".repeat(MAX_INGREDIENT_NAME_LENGTH + 1) }),
    );

    expect(parsed).toEqual({ ok: false, errors: { ingredientName: expect.any(String) } });
  });

  it("accepts a name exactly at the length limit", () => {
    const name = "a".repeat(MAX_INGREDIENT_NAME_LENGTH);
    const parsed = parsePantryEntry(newEntry({ ingredientName: name }));

    expect(parsed.ok && parsed.value.ingredient).toEqual({ kind: "new", name });
  });

  it("rejects a missing ingredient field rather than reading it as a name", () => {
    const parsed = parsePantryEntry(existingEntry({ ingredientId: null }));

    expect(parsed.ok).toBe(false);
  });
});

describe("parsePantryEntry, the optional density", () => {
  it("carries a density through for a new ingredient", () => {
    const parsed = parsePantryEntry(newEntry({ densityGPerMl: "0.85" }));

    expect(parsed.ok && parsed.value.ingredient).toEqual({
      kind: "new",
      name: "Caster sugar",
      densityGPerMl: 0.85,
    });
  });

  it("leaves the density absent when the field is blank", () => {
    // Absent has to stay distinguishable from zero: it is what makes a
    // mass<->volume line report "can't verify" (SPEC.md §3).
    const parsed = parsePantryEntry(newEntry({ densityGPerMl: "  " }));

    expect(parsed.ok && parsed.value.ingredient).toEqual({ kind: "new", name: "Caster sugar" });
  });

  it("rejects a zero density rather than storing one that cannot convert", () => {
    const parsed = parsePantryEntry(newEntry({ densityGPerMl: "0" }));

    expect(parsed).toEqual({ ok: false, errors: { densityGPerMl: expect.any(String) } });
  });

  it("rejects a NaN density, which slips past a bare `> 0` guard", () => {
    const parsed = parsePantryEntry(newEntry({ densityGPerMl: "NaN" }));

    expect(parsed).toEqual({ ok: false, errors: { densityGPerMl: expect.any(String) } });
  });

  it("ignores a density submitted against an existing catalog entry", () => {
    // v1 has no surface for editing an existing ingredient's density
    // (SPEC.md §2, Out) — a crafted field must not become one.
    const parsed = parsePantryEntry(existingEntry({ densityGPerMl: "9.9" }));

    expect(parsed.ok && parsed.value.ingredient).toEqual({ kind: "existing", id: EXISTING_ID });
  });
});

describe("parsePantryAmount", () => {
  it("reads a decimal quantity and a known unit", () => {
    expect(parsePantryAmount({ quantity: " 2.5 ", unitId: "tbsp" })).toEqual({
      ok: true,
      value: { quantity: 2.5, unitId: "tbsp" },
    });
  });

  it("rejects a blank quantity rather than reading it as zero", () => {
    // `Number("")` is 0, which passes a naive `Number.isFinite` check.
    expect(parsePantryAmount({ quantity: "", unitId: "g" })).toEqual({
      ok: false,
      errors: { quantity: expect.any(String) },
    });
  });

  it("rejects a quantity of zero", () => {
    expect(parsePantryAmount({ quantity: "0", unitId: "g" }).ok).toBe(false);
  });

  it("rejects a negative quantity", () => {
    // CLAUDE.md: rejected at the data-entry layer, because the matching engine
    // assumes valid input.
    expect(parsePantryAmount({ quantity: "-1", unitId: "g" }).ok).toBe(false);
  });

  it("rejects an infinite quantity, which would make any recipe look makeable", () => {
    expect(parsePantryAmount({ quantity: "Infinity", unitId: "g" }).ok).toBe(false);
  });

  it("rejects a quantity that overflows to infinity", () => {
    expect(parsePantryAmount({ quantity: `1${"0".repeat(400)}`, unitId: "g" }).ok).toBe(false);
  });

  it("rejects a quantity that is not a number", () => {
    expect(parsePantryAmount({ quantity: "a pinch", unitId: "g" }).ok).toBe(false);
  });

  it("rejects an unknown unit", () => {
    expect(parsePantryAmount({ quantity: "1", unitId: "furlong" })).toEqual({
      ok: false,
      errors: { unitId: expect.any(String) },
    });
  });

  it("rejects an inherited property name as a unit", () => {
    // `unitId in UNITS` would say yes to this and then index to a function.
    expect(parsePantryAmount({ quantity: "1", unitId: "constructor" }).ok).toBe(false);
  });

  it("reports every bad field at once rather than one per submission", () => {
    const parsed = parsePantryAmount({ quantity: "nope", unitId: "furlong" });

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && Object.keys(parsed.errors).sort()).toEqual(["quantity", "unitId"]);
  });
});

describe("parsePantryItemId", () => {
  it("accepts a well-formed uuid", () => {
    expect(parsePantryItemId(EXISTING_ID)).toEqual({ ok: true, value: EXISTING_ID });
  });

  it("rejects anything that is not a uuid", () => {
    expect(parsePantryItemId("../../etc/passwd")).toEqual({
      ok: false,
      errors: { id: expect.any(String) },
    });
  });

  it("rejects a missing id", () => {
    expect(parsePantryItemId(null).ok).toBe(false);
  });
});
