import { describe, expect, it } from "vitest";

import { toPantry, toRecipe } from "./from-storage";
import { matchRecipe } from "./match";
import { UNITS } from "./units";

/**
 * The adapter is the only seam between stored rows and the matching engine, so
 * the things that can only go wrong here are the ones worth asserting: a unit
 * id that has to become a conversion factor, and a nullable density column that
 * has to become an *absent* one rather than a null the engine would arithmetic
 * on.
 */

const flour = { id: "ing-flour", name: "Flour", densityGPerMl: 0.53 };
const vanilla = { id: "ing-vanilla", name: "Vanilla extract", densityGPerMl: null };

describe("toPantry", () => {
  it("resolves a stored unit id into the unit the engine converts with", () => {
    const [item] = toPantry([{ item: { quantity: 500, unitId: "g" }, ingredient: flour }]);

    expect(item?.quantity).toEqual({ value: 500, unit: UNITS.g });
  });

  it("carries a stored density through so mass and volume stay comparable", () => {
    const [item] = toPantry([{ item: { quantity: 500, unitId: "g" }, ingredient: flour }]);

    expect(item?.ingredient.densityGPerMl).toBe(0.53);
  });

  it("turns a null density into an absent one, not a null", () => {
    // `convert` asks `densityGPerMl === undefined`. A null arriving intact
    // would slip past that guard and multiply, yielding 0 rather than the
    // "can't verify" the spec requires.
    const [item] = toPantry([{ item: { quantity: 30, unitId: "g" }, ingredient: vanilla }]);

    expect(item?.ingredient.densityGPerMl).toBeUndefined();
  });

  it("refuses a unit id the engine has no conversion factor for", () => {
    expect(() =>
      toPantry([{ item: { quantity: 1, unitId: "furlong" }, ingredient: flour }]),
    ).toThrow(/furlong/);
  });
});

describe("toRecipe", () => {
  it("builds the engine's recipe shape from a stored recipe and its lines", () => {
    const recipe = toRecipe({ name: "Bread", baseServings: 4 }, [
      { line: { quantity: 300, unitId: "g" }, ingredient: flour },
    ]);

    expect(recipe).toEqual({
      name: "Bread",
      baseServings: 4,
      ingredients: [
        {
          ingredient: { id: "ing-flour", name: "Flour", densityGPerMl: 0.53 },
          quantity: { value: 300, unit: UNITS.g },
        },
      ],
    });
  });

  it("produces shapes the engine can match end to end", () => {
    // The adapter's whole job is to feed `matchRecipe`; asserting the field
    // names alone would still pass if a unit arrived as a bare string.
    const result = matchRecipe(
      toRecipe({ name: "Bread", baseServings: 4 }, [
        { line: { quantity: 300, unitId: "g" }, ingredient: flour },
      ]),
      toPantry([{ item: { quantity: 1, unitId: "kg" }, ingredient: flour }]),
    );

    expect(result.makeable).toBe(true);
    expect(result.lines[0]?.available).toBe(1000);
  });
});
