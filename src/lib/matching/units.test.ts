import { describe, expect, it } from "vitest";

import { UNITS, convert, isUnitKey, unitById } from "./units";

/**
 * `unit_id` is a text column, so everything that comes back out of Postgres or
 * in off a form is a plain string until something narrows it. These two are
 * that something.
 */

describe("isUnitKey", () => {
  it("accepts every key the unit table defines", () => {
    expect(Object.keys(UNITS).every(isUnitKey)).toBe(true);
  });

  it("rejects a string that is not a unit", () => {
    expect(isUnitKey("furlong")).toBe(false);
  });

  it("rejects an inherited Object property name", () => {
    // `UNITS[value] !== undefined` would answer true for these and hand the
    // caller a function where a unit was expected.
    expect(isUnitKey("constructor")).toBe(false);
    expect(isUnitKey("toString")).toBe(false);
  });
});

describe("unitById", () => {
  it("resolves a known id to its conversion factor", () => {
    expect(unitById("cup")).toBe(UNITS.cup);
  });

  it("returns nothing for an unknown id", () => {
    expect(unitById("furlong")).toBeUndefined();
  });
});

describe("convert", () => {
  it("converts across dimensions when a density is available", () => {
    expect(convert(1, UNITS.cup, UNITS.g, 0.85)).toBeCloseTo(201.1, 1);
  });

  it("cannot verify a conversion whose result is not a finite number", () => {
    // The data-entry layer bounds density, but the CHECK constraint behind it
    // only says `> 0 AND < Infinity` — a density of 1e-300 stores cleanly and
    // divides a real pantry quantity into Infinity. `Infinity >= required` is
    // true, so without this the recipe reports "have enough" off almost
    // nothing. That is the failure CLAUDE.md's float gotcha is about, reached
    // through the divisor rather than through the quantity.
    expect(convert(1e6, UNITS.kg, UNITS.ml, 1e-300)).toBeNull();
  });
});
