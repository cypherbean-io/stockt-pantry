import type { ReactElement, ReactNode } from "react";

import { Card } from "./card";
import { cx } from "./class-names";

/**
 * Every table in the app (SPEC.md §3.6): a real table from `sm` up, and a
 * stack of cards below it with the column names becoming labels. Not
 * `overflow-x: auto` — a horizontally scrolling table on a phone in a kitchen
 * is not a fix.
 *
 * Both layouts are rendered and CSS shows one. `display: none` takes the other
 * out of the accessibility tree as well as off the screen, so a screen reader
 * meets each row once at either width. The cost is every cell rendered twice,
 * which is why a cell must never carry an `id`: it would be on the page twice.
 *
 * One component rather than three hand-written pairs, because the rule is
 * that every table does this — `/recipes`, the match table on `/recipes/[id]`,
 * the household's invites — and a rule kept in three places is a rule that
 * drifts.
 */

export type Column<Row> = {
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
};

const CELL = "px-4 py-2 align-middle";

export function DataTable<Row>({
  label,
  rows,
  rowKey,
  rowHeader,
  columns,
}: {
  /** The table's caption and the list's name: what a screen reader calls it. */
  readonly label: string;
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /**
   * The column that names a row, if one does. It becomes the row's `<th>` in
   * the table and the card's title below `sm`, rather than one more labelled
   * value.
   */
  readonly rowHeader?: Column<Row>;
  readonly columns: readonly Column<Row>[];
}): ReactElement {
  return (
    <>
      <div className="hidden rounded-card border border-border bg-surface-raised sm:block">
        <table className="w-full text-left">
          <caption className="sr-only">{label}</caption>
          <thead className="border-b border-border">
            <tr>
              {[...(rowHeader === undefined ? [] : [rowHeader]), ...columns].map(({ header }) => (
                <th key={header} scope="col" className="px-4 py-2.5 text-sm font-medium text-ink-muted">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {rowHeader !== undefined && (
                  <th scope="row" className={cx(CELL, "font-medium text-ink")}>
                    {rowHeader.cell(row)}
                  </th>
                )}
                {columns.map(({ header, cell }) => (
                  <td key={header} className={cx(CELL, "text-ink")}>
                    {cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={label} className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <Card as="li" key={rowKey(row)}>
            {rowHeader !== undefined && (
              <div className="mb-2 font-semibold text-ink">{rowHeader.cell(row)}</div>
            )}
            <dl className="flex flex-col gap-1.5 text-sm">
              {columns.map(({ header, cell }) => (
                <div
                  key={header}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
                >
                  <dt className="text-ink-muted">{header}</dt>
                  <dd className="text-ink">{cell(row)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </ul>
    </>
  );
}
