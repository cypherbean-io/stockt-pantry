import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataTable } from "./data-table";

/**
 * SPEC.md §3.6's responsive rule, in the one place it lives: every table in
 * the app is a real table from `sm` up and a stack of cards below it, "with
 * the column names becoming labels". Not `overflow-x: auto` — a horizontally
 * scrolling table on a phone in a kitchen is not a fix.
 *
 * Both layouts are in the markup and CSS shows one. `display: none` takes the
 * other out of the accessibility tree as well as off the screen, so a screen
 * reader meets each row once, at either width.
 */

type Row = { readonly id: string; readonly name: string; readonly needed: string; readonly have: string };

const ROWS: readonly Row[] = [
  { id: "a", name: "Chickpeas", needed: "240 g", have: "500" },
  { id: "b", name: "Tomatoes", needed: "400 g", have: "100" },
  { id: "c", name: "Coriander", needed: "1 count", have: "—" },
];

const COLUMNS = [
  { header: "Needed", cell: (row: Row) => row.needed },
  { header: "Have", cell: (row: Row) => row.have },
] as const;

function table(withRowHeader = true): string {
  return renderToStaticMarkup(
    <DataTable
      label="Ingredients against the pantry"
      rows={ROWS}
      rowKey={(row) => row.id}
      rowHeader={withRowHeader ? { header: "Ingredient", cell: (row) => row.name } : undefined}
      columns={COLUMNS}
    />,
  );
}

function count(markup: string, pattern: RegExp): number {
  return [...markup.matchAll(pattern)].length;
}

/** The class attribute of the element that directly wraps the `<table>`. */
function tableWrapperClasses(markup: string): readonly string[] {
  return (/<div class="([^"]*)"><table\b/.exec(markup)?.[1] ?? "").split(/\s+/);
}

/** The class attribute of the list the table collapses into. */
function listClasses(markup: string): readonly string[] {
  return (/<ul\b[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? "").split(/\s+/);
}

describe("a data table", () => {
  it("is a real table from sm up, and out of the layout below it", () => {
    const wrapper = tableWrapperClasses(table());

    expect(wrapper).toContain("hidden");
    expect(wrapper).toContain("sm:block");
  });

  it("is a list of cards below sm, and out of the layout from sm up", () => {
    // Paired with the test above: one layout per width, never both, never
    // neither. A table hidden everywhere would be the classic way to "fix"
    // overflow on a phone.
    expect(listClasses(table())).toContain("sm:hidden");
  });

  it("puts every row in both layouts", () => {
    const markup = table();

    expect(count(markup, /<tr\b/g)).toBe(ROWS.length + 1); // plus the header row
    expect(count(markup, /<li\b/g)).toBe(ROWS.length);
  });

  it("turns the column names into labels on the cards", () => {
    // Below sm there is no header row to read a value against; "240 g"
    // alone does not say whether it is needed or held.
    const markup = table();

    for (const { header } of COLUMNS) {
      expect(count(markup, new RegExp(`<dt\\b[^>]*>${header}</dt>`, "g"))).toBe(ROWS.length);
    }
  });

  it("gives the table and the list the same name", () => {
    const markup = table();

    expect(markup).toMatch(/<caption\b[^>]*>Ingredients against the pantry<\/caption>/);
    expect(markup).toMatch(/<ul\b[^>]*aria-label="Ingredients against the pantry"/);
  });

  it("scopes each header to what it labels", () => {
    // A screen reader announces a cell with its column header and its row
    // header, which is what makes "500" in the middle of the table mean
    // "500 of chickpeas in the pantry".
    const markup = table();

    expect(count(markup, /<th\b[^>]*scope="col"/g)).toBe(COLUMNS.length + 1);
    expect(count(markup, /<th\b[^>]*scope="row"/g)).toBe(ROWS.length);
  });

  it("leads each card with the cell that names its row", () => {
    // The card's title, rather than one more labelled value.
    const markup = table();

    expect(count(markup, /<dt\b[^>]*>Ingredient<\/dt>/g)).toBe(0);
    for (const { name } of ROWS) {
      expect(markup).toMatch(new RegExp(`<li\\b[^>]*><[^>]+>${name}<`));
    }
  });

  it("labels every value when no column names the row", () => {
    // The household's invites have no natural title column — every value on
    // the card is a labelled one, and no cell is promoted to a row header.
    const markup = table(false);

    expect(count(markup, /<th\b[^>]*scope="row"/g)).toBe(0);
    expect(count(markup, /<th\b[^>]*scope="col"/g)).toBe(COLUMNS.length);
    expect(count(markup, /<dt\b/g)).toBe(ROWS.length * COLUMNS.length);
  });
});
