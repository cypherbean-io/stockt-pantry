import type { Ingredient, PantryItem, Recipe } from "./matching/types";
import { UNITS } from "./matching/units";

/**
 * Hardcoded stand-in for the per-household pantry and recipe rows.
 *
 * This is the skeleton's only data source — it exists so one input can travel
 * end to end through the matching engine and out to the page before Drizzle,
 * Postgres, and auth land. Delete it once those queries are real; nothing here
 * should outlive the DB slice.
 */

const flour: Ingredient = { id: "flour", name: "All-purpose flour", densityGPerMl: 0.53 };
const sugar: Ingredient = { id: "sugar", name: "Granulated sugar", densityGPerMl: 0.85 };
const egg: Ingredient = { id: "egg", name: "Egg" };
const butter: Ingredient = { id: "butter", name: "Butter", densityGPerMl: 0.911 };
const chocolateChips: Ingredient = { id: "choc-chips", name: "Chocolate chips" };
// Deliberately no density: forces the mass<->volume "can't verify" path.
const vanilla: Ingredient = { id: "vanilla", name: "Vanilla extract" };

export const PANTRY: readonly PantryItem[] = [
  { ingredient: flour, quantity: { value: 500, unit: UNITS.g } },
  { ingredient: sugar, quantity: { value: 2, unit: UNITS.cup } },
  { ingredient: egg, quantity: { value: 3, unit: UNITS.count } },
  { ingredient: chocolateChips, quantity: { value: 100, unit: UNITS.g } },
  { ingredient: vanilla, quantity: { value: 30, unit: UNITS.g } },
  // No butter at all.
];

export const RECIPE: Recipe = {
  name: "Chocolate Chip Cookies",
  baseServings: 24,
  ingredients: [
    { ingredient: flour, quantity: { value: 300, unit: UNITS.g } },
    { ingredient: sugar, quantity: { value: 200, unit: UNITS.g } },
    { ingredient: egg, quantity: { value: 2, unit: UNITS.count } },
    { ingredient: butter, quantity: { value: 225, unit: UNITS.g } },
    { ingredient: chocolateChips, quantity: { value: 200, unit: UNITS.g } },
    { ingredient: vanilla, quantity: { value: 2, unit: UNITS.tsp } },
  ],
};
