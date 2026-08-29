import { describe, expect, it } from "vitest";

import { UNITS } from "@/lib/matching/units";
import { parseIngredientLine } from "./parse-line";

describe("parseIngredientLine", () => {
  it("splits a plain quantity, unit and name", () => {
    expect(parseIngredientLine("300 g all-purpose flour")).toEqual({
      raw: "300 g all-purpose flour",
      quantity: 300,
      unit: UNITS.g,
      name: "all-purpose flour",
      confidence: "high",
    });
  });

  it("reads a mixed number written as a whole part and a fraction", () => {
    const line = parseIngredientLine("1 1/2 cups granulated sugar");

    expect(line.quantity).toBe(1.5);
    expect(line.unit).toBe(UNITS.cup);
    expect(line.name).toBe("granulated sugar");
  });

  it("reads a bare fraction", () => {
    const line = parseIngredientLine("3/4 cup milk");

    expect(line.quantity).toBe(0.75);
    expect(line.unit).toBe(UNITS.cup);
  });

  it("reads a unicode vulgar fraction", () => {
    const line = parseIngredientLine("½ tsp vanilla extract");

    expect(line.quantity).toBe(0.5);
    expect(line.unit).toBe(UNITS.tsp);
    expect(line.name).toBe("vanilla extract");
  });

  it("reads a mixed number written with a unicode fraction", () => {
    expect(parseIngredientLine("2¼ cups flour").quantity).toBe(2.25);
  });

  it("reads a decimal quantity", () => {
    expect(parseIngredientLine("0.5 kg butter").quantity).toBe(0.5);
  });

  it.each([
    ["1 cup water", UNITS.cup],
    ["1 c. water", UNITS.cup],
    ["2 tablespoons olive oil", UNITS.tbsp],
    ["2 tbsp. olive oil", UNITS.tbsp],
    ["1 teaspoon salt", UNITS.tsp],
    ["250 grams flour", UNITS.g],
    ["2 kilograms potatoes", UNITS.kg],
    ["8 ounces cream cheese", UNITS.oz],
    ["1 pound butter", UNITS.lb],
    ["2 lbs beef", UNITS.lb],
    ["500 ml stock", UNITS.ml],
    ["1 litre water", UNITS.l],
    ["1 L water", UNITS.l],
  ])("maps the unit words in %s onto the canonical unit table", (raw, unit) => {
    expect(parseIngredientLine(raw).unit).toBe(unit);
  });

  it("treats a counted item with no unit word as a count", () => {
    const line = parseIngredientLine("3 large eggs");

    expect(line.quantity).toBe(3);
    expect(line.unit).toBe(UNITS.count);
    expect(line.name).toBe("large eggs");
    // A count is inferred, not stated, so the row still wants a human eye.
    expect(line.confidence).toBe("medium");
  });

  it("drops a filler 'of' between the unit and the ingredient name", () => {
    expect(parseIngredientLine("1 cup of whole milk").name).toBe("whole milk");
  });

  it("flags an unquantified line as low confidence instead of defaulting it", () => {
    // SPEC.md §5: an ambiguous line must still require explicit confirmation.
    const line = parseIngredientLine("a pinch of salt");

    expect(line.quantity).toBeNull();
    expect(line.unit).toBeNull();
    expect(line.confidence).toBe("low");
    expect(line.name).toBe("a pinch of salt");
  });

  it("flags a quantity range as low confidence and keeps its lower bound", () => {
    const line = parseIngredientLine("2-3 tablespoons water");

    expect(line.quantity).toBe(2);
    expect(line.unit).toBe(UNITS.tbsp);
    expect(line.confidence).toBe("low");
  });

  it("flags a line whose unit is outside the canonical table as low confidence", () => {
    const line = parseIngredientLine("2 cloves garlic");

    expect(line.quantity).toBe(2);
    expect(line.unit).toBe(UNITS.count);
    expect(line.name).toBe("cloves garlic");
    expect(line.confidence).toBe("medium");
  });

  it("keeps the raw line verbatim so the review screen can show what was parsed", () => {
    const raw = "  1 1/2 cups   sugar  ";

    expect(parseIngredientLine(raw).raw).toBe(raw);
    expect(parseIngredientLine(raw).name).toBe("sugar");
  });

  it("returns a low-confidence empty row for a blank line rather than throwing", () => {
    const line = parseIngredientLine("   ");

    expect(line.quantity).toBeNull();
    expect(line.confidence).toBe("low");
  });

  it("does not mistake a number inside the ingredient name for a quantity", () => {
    const line = parseIngredientLine("dark chocolate, 70% cocoa");

    expect(line.quantity).toBeNull();
    expect(line.name).toBe("dark chocolate, 70% cocoa");
  });
});
