import { describe, expect, it } from "vitest";

import {
  assertOptionalDensity,
  assertPositiveQuantity,
  assertPositiveServings,
} from "./validate";

/**
 * The data-entry guard that runs before anything reaches Postgres (CLAUDE.md:
 * zero/negative quantities are rejected here, not in the matching logic).
 *
 * These are pure functions, so they live in the `unit` project and need no
 * database — the matching CHECK constraints are covered against a real
 * Postgres in `tenant-isolation.test.ts`.
 */

describe("assertPositiveQuantity", () => {
  it.each([
    ["zero", 0],
    ["a negative value", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("rejects %s", (_label, value) => {
    expect(() => assertPositiveQuantity(value, "Quantity")).toThrow(/finite quantity/i);
  });

  it.each([
    ["a whole number", 500],
    ["a fraction", 1.5],
    ["a very small positive value", Number.MIN_VALUE],
  ])("accepts %s", (_label, value) => {
    expect(assertPositiveQuantity(value, "Quantity")).toBe(value);
  });

  it("names the offending field in the message", () => {
    expect(() => assertPositiveQuantity(0, "Density")).toThrow(/^Density /);
  });
});

describe("assertOptionalDensity", () => {
  it("passes through an absent density, which means 'can't verify'", () => {
    expect(assertOptionalDensity(undefined)).toBeUndefined();
  });

  it("rejects a NaN density rather than storing an unusable one", () => {
    expect(() => assertOptionalDensity(Number.NaN)).toThrow(/finite quantity/i);
  });

  it("accepts a real density", () => {
    expect(assertOptionalDensity(0.53)).toBe(0.53);
  });
});

describe("assertPositiveServings", () => {
  it.each([
    ["zero", 0],
    ["a negative count", -2],
    ["a fractional count", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s", (_label, value) => {
    expect(() => assertPositiveServings(value)).toThrow(/whole number/i);
  });

  it("accepts a whole serving count", () => {
    expect(assertPositiveServings(4)).toBe(4);
  });
});
