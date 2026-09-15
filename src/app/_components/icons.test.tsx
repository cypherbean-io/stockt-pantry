import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as icons from "./icons";

/**
 * SPEC.md §3.6: the glyph set is hand-rolled inline SVG rather than an icon
 * package, so nothing ships that is not used and no dependency is added for
 * decoration. That trade only holds if the hand-rolled ones behave, and there
 * are exactly three ways they have to.
 *
 * The invariants run over *every* export rather than a list written out here.
 * A tenth glyph added next week is covered without anyone remembering to add
 * it, which is the whole reason this is a loop.
 */

type Glyph = (props: { readonly className?: string }) => ReactElement;

const GLYPHS: ReadonlyArray<readonly [string, Glyph]> = Object.entries(icons);

describe.each(GLYPHS)("%s", (_name, Icon) => {
  const markup = renderToStaticMarkup(<Icon />);

  it("is hidden from assistive technology, because the text beside it says the same thing", () => {
    // SPEC.md §3.5: colour never carries meaning alone, so every glyph in this
    // app sits next to a label. Exposing the SVG as well would announce the
    // status twice — "check, have enough" — which is worse than silent.
    expect(markup).toContain('aria-hidden="true"');
  });

  it("takes its colour from the text around it rather than naming one", () => {
    // A glyph inherits its status token from the badge it sits in. A literal
    // here would be a colour that does not change between light and dark, and
    // that no contrast assertion in tokens.test.ts covers.
    expect(markup).toContain("currentColor");
    expect(markup).not.toMatch(/#[0-9a-f]{3}|rgb\(|hsl\(/i);
  });

  it("is drawn on the same grid as every other glyph, so a row of them lines up", () => {
    expect(markup).toContain('viewBox="0 0 16 16"');
  });
});

describe("the glyph set", () => {
  it("lets a caller size and colour a glyph from its call site", () => {
    // Every glyph is used at more than one size — inline in a badge, larger in
    // an empty state — so the class has to be the caller's to set.
    const [, Icon] = GLYPHS[0] ?? [];
    if (Icon === undefined) throw new Error("icons.tsx exports nothing");

    expect(renderToStaticMarkup(<Icon className="text-ink-muted" />)).toContain(
      'class="text-ink-muted"',
    );
  });

  it("draws every glyph differently", () => {
    // Two statuses sharing a glyph would quietly undo SPEC.md §3.5: the glyph
    // is what distinguishes `--status-mixed` from `--status-warn`, which are
    // 25 degrees apart on purpose and are not meant to be told apart by eye.
    const drawings = GLYPHS.map(([, Icon]) => renderToStaticMarkup(<Icon />));

    expect(new Set(drawings).size).toBe(GLYPHS.length);
  });
});
