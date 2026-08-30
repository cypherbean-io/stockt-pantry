import type { LineStatus, MatchResult, MatchedLine } from "@/lib/matching/types";

/**
 * Rendering for a match result.
 *
 * The three not-makeable statuses are deliberately not collapsed into one
 * (SPEC.md §3 step 5): "missing" and "short" are fixed by buying something,
 * "unresolved" is fixed by knowing the ingredient's density. A user who cannot
 * tell them apart cannot tell which of those to go and do.
 */

const STATUS_LABEL: Record<LineStatus, string> = {
  have: "have enough",
  short: "short",
  missing: "missing",
  unresolved: "can't verify without a density",
};

/** Floats out of a unit conversion are long; nobody needs 402.19999999999993 g. */
export function round(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function statusLabel(status: LineStatus): string {
  return STATUS_LABEL[status];
}

/** One line for a recipe in a list, where the per-line table is not shown. */
export function summarise(result: MatchResult): string {
  if (result.makeable) {
    return "Ready to cook";
  }

  const toBuy = result.lines.filter(
    (line) => line.status === "missing" || line.status === "short",
  ).length;
  const unresolved = result.lines.filter((line) => line.status === "unresolved").length;

  const parts: string[] = [];
  if (toBuy > 0) parts.push(`${toBuy} to buy`);
  if (unresolved > 0) parts.push(`${unresolved} can't verify`);
  // A recipe with no ingredient lines at all is vacuously makeable, so an
  // empty `parts` here would mean the counts and `makeable` disagree.
  return parts.length === 0 ? "Not makeable" : parts.join(", ");
}

export function MatchTable({ result }: { result: MatchResult }) {
  if (result.lines.length === 0) {
    return <p>This recipe has no ingredients listed.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th align="left">Ingredient</th>
          <th align="left">Needed</th>
          <th align="left">Have (in the recipe&rsquo;s unit)</th>
          <th align="left">Status</th>
        </tr>
      </thead>
      <tbody>
        {result.lines.map((line) => (
          <tr key={line.ingredient.id}>
            <td>{line.ingredient.name}</td>
            <td>
              {round(line.required.value)} {line.required.unit.name}
            </td>
            <td>{line.available === null ? "—" : round(line.available)}</td>
            <td>{statusLabel(line.status)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Read-only output, and it stays that way: checking something off here never
 * writes to `pantry_item` (SPEC.md §3, an explicit v1 scope cut).
 */
export function ShoppingList({ lines }: { lines: readonly MatchedLine[] }) {
  if (lines.length === 0) {
    return <p>Nothing to buy.</p>;
  }

  return (
    <ul>
      {lines.map((line) => (
        <li key={line.ingredient.id}>
          {line.ingredient.name}: {round(line.shortfall)} {line.required.unit.name}
        </li>
      ))}
    </ul>
  );
}
