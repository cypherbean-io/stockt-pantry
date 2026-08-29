import type {
  MatchResult,
  MatchedLine,
  PantryItem,
  Recipe,
  RecipeIngredient,
} from "./types";
import { convert } from "./units";

/**
 * The matching algorithm from SPEC.md §3.
 *
 * Assumes valid input: zero/negative quantities are rejected at the data-entry
 * layer, not here (CLAUDE.md conventions).
 */

function matchLine(
  line: RecipeIngredient,
  pantry: readonly PantryItem[],
  scale: number,
): MatchedLine {
  const required = { value: line.quantity.value * scale, unit: line.quantity.unit };
  const held = pantry.find((item) => item.ingredient.id === line.ingredient.id);

  if (held === undefined) {
    return {
      ingredient: line.ingredient,
      required,
      available: 0,
      status: "missing",
      shortfall: required.value,
    };
  }

  const available = convert(
    held.quantity.value,
    held.quantity.unit,
    required.unit,
    line.ingredient.densityGPerMl,
  );

  if (available === null) {
    return {
      ingredient: line.ingredient,
      required,
      available: null,
      status: "unresolved",
      shortfall: 0,
    };
  }

  if (available >= required.value) {
    return {
      ingredient: line.ingredient,
      required,
      available,
      status: "have",
      shortfall: 0,
    };
  }

  return {
    ingredient: line.ingredient,
    required,
    available,
    status: "short",
    shortfall: required.value - available,
  };
}

/**
 * Evaluate a recipe against a pantry at a target serving count.
 *
 * The recipe is makeable only if every line is "have" — a single missing,
 * short, or unresolved line blocks it, but the per-line status is preserved so
 * the UI can tell "buy this" apart from "we can't verify this".
 */
export function matchRecipe(
  recipe: Recipe,
  pantry: readonly PantryItem[],
  servings: number = recipe.baseServings,
): MatchResult {
  const scale = servings / recipe.baseServings;
  const lines = recipe.ingredients.map((line) => matchLine(line, pantry, scale));

  return {
    recipeName: recipe.name,
    servings,
    makeable: lines.every((line) => line.status === "have"),
    lines,
  };
}

/**
 * Shopping list = every missing or short line, with its shortfall in the
 * recipe's own unit. Read-only output; it never writes back to the pantry
 * (SPEC.md §3, explicit v1 scope cut).
 */
export function shoppingList(result: MatchResult): readonly MatchedLine[] {
  return result.lines.filter(
    (line) => line.status === "missing" || line.status === "short",
  );
}
