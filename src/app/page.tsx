import Link from "next/link";

import { PANTRY, RECIPE } from "@/lib/fixtures";
import { matchRecipe, shoppingList } from "@/lib/matching/match";
import type { LineStatus, MatchedLine } from "@/lib/matching/types";

const STATUS_LABEL: Record<LineStatus, string> = {
  have: "have enough",
  short: "short",
  missing: "missing",
  unresolved: "can't verify without density",
};

function round(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function LineRow({ line }: { line: MatchedLine }) {
  return (
    <tr>
      <td>{line.ingredient.name}</td>
      <td>
        {round(line.required.value)} {line.required.unit.name}
      </td>
      <td>{line.available === null ? "—" : round(line.available)}</td>
      <td>{STATUS_LABEL[line.status]}</td>
    </tr>
  );
}

export default function Home() {
  const result = matchRecipe(RECIPE, PANTRY);
  const missing = shoppingList(result);

  return (
    <main>
      <h1>Stockt Pantry</h1>
      {/*
        Still the fixture-driven demo of the matching engine — wiring this page
        to a real household's pantry is the pantry slice, not the auth one.
      */}
      <p>
        <Link href="/household">Your household</Link>
      </p>

      <h2>
        {result.recipeName} — {result.servings} servings
      </h2>
      <p>
        <strong>{result.makeable ? "Makeable" : "Not makeable"}</strong>
      </p>

      <table>
        <thead>
          <tr>
            <th align="left">Ingredient</th>
            <th align="left">Needed</th>
            <th align="left">Have (in recipe unit)</th>
            <th align="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((line) => (
            <LineRow key={line.ingredient.id} line={line} />
          ))}
        </tbody>
      </table>

      <h2>Shopping list</h2>
      {missing.length === 0 ? (
        <p>Nothing to buy.</p>
      ) : (
        <ul>
          {missing.map((line) => (
            <li key={line.ingredient.id}>
              {line.ingredient.name}: {round(line.shortfall)}{" "}
              {line.required.unit.name}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
