import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Card, CardHeader } from "./card";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

/**
 * SPEC.md §3.6: `Card`/`CardHeader`, `PageHeader` and `EmptyState` — the three
 * surfaces every screen is built out of.
 *
 * What is worth asserting about them is the document structure, not the
 * padding. A heading level is the outline a screen reader navigates by, and a
 * `<div>` where a list item belongs is markup a browser silently reflows.
 */

describe("a page header", () => {
  it("gives the page its one h1", () => {
    // Every screen renders exactly one of these, which is what makes it safe
    // for the cards below to start at h2/h3.
    expect(renderToStaticMarkup(<PageHeader title="What can I make?" />)).toContain("<h1");
  });

  it("leaves the description out rather than rendering an empty paragraph", () => {
    expect(renderToStaticMarkup(<PageHeader title="Your pantry" />)).not.toContain("<p");
  });

  it("puts the page's action beside its title", () => {
    // SPEC.md §3.3 deletes the per-page lines of separated links; the
    // contextual ones become actions here instead.
    const markup = renderToStaticMarkup(
      <PageHeader title="What can I make?" action={<button type="button">Import</button>} />,
    );

    expect(markup).toContain("Import");
  });
});

describe("a card", () => {
  it("renders as the element its container needs", () => {
    // SPEC.md §3.6: below `sm` every table collapses into stacked cards. Those
    // stacks are lists, and a <div> child of a <ul> is invalid markup that
    // browsers reparent.
    expect(renderToStaticMarkup(<Card as="li">Chickpeas</Card>)).toMatch(/^<li\b/);
  });

  it("is a div when the caller does not say otherwise", () => {
    expect(renderToStaticMarkup(<Card>Chickpeas</Card>)).toMatch(/^<div\b/);
  });
});

describe("a card header", () => {
  it("sits below the page title by default", () => {
    // A card is nested inside the page, so h3 under the page's h1 and a
    // section's h2 is the outline that reads correctly without a prop.
    expect(renderToStaticMarkup(<CardHeader title="Chana masala" />)).toContain("<h3");
  });

  it("takes the level the section around it actually needs", () => {
    expect(renderToStaticMarkup(<CardHeader title="Chana masala" headingLevel={2} />)).toContain(
      "<h2",
    );
  });

  it("keeps the card's action on the same row as its title", () => {
    const markup = renderToStaticMarkup(
      <CardHeader title="Chickpeas" action={<button type="button">Remove</button>} />,
    );

    expect(markup).toContain("Remove");
  });
});

describe("an empty state", () => {
  it("says what the screen would have shown", () => {
    expect(renderToStaticMarkup(<EmptyState>No recipes yet.</EmptyState>)).toContain(
      "No recipes yet.",
    );
  });

  it("offers the action that fills it", () => {
    // An empty state without a way out is just a smaller version of the
    // problem. `/recipes` and `/pantry` both land here on a fresh household.
    const markup = renderToStaticMarkup(
      <EmptyState action={<button type="button">Add the first one</button>}>
        No recipes yet.
      </EmptyState>,
    );

    expect(markup).toContain("Add the first one");
  });
});
