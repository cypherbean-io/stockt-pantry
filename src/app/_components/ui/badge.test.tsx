import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LineStatus } from "@/lib/matching/types";

import { Badge, STATUS_TONES, StatusBadge, statusLabel } from "./badge";

/**
 * SPEC.md §3.5/§3.6: the badge is where a match status becomes something you
 * can see. Its job is to put three things on screen at once — a token, a glyph
 * and a text label — and the tests below are one per thing, plus the pairing
 * rule that ties the first to `src/design/tokens.test.ts`.
 */

const STATUSES: readonly LineStatus[] = ["have", "short", "missing", "unresolved"];

function classOf(markup: string): string {
  return /class="([^"]*)"/.exec(markup)?.[1] ?? "";
}

/**
 * The text a reader would see, walked directly off the React element tree
 * rather than parsed out of rendered HTML.
 *
 * The original version of this helper rendered to a string and stripped tags
 * with `markup.replace(/<[^>]*>/g, "")`. CodeQL flags that pattern —
 * `js/incomplete-multi-character-sanitization` — because a single regex pass
 * over HTML is exactly the class of bug this repo already fixed once, in
 * `src/lib/import/jsonld.ts` (`js/bad-tag-filter`): a crafted nested or
 * malformed tag survives one pass and reconstructs into something the pass
 * was meant to remove. The fix there was a correct comment-end pattern; the
 * fix here is smaller than that, because there is no HTML to parse in the
 * first place. React already has the tree before `renderToStaticMarkup` ever
 * serialises it, and reading that tree directly needs no escaping — or
 * unescaping — in either direction.
 */
function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";

  const element = node as ReactElement<{ readonly children?: ReactNode }>;

  // A host element (span, svg, path, ...) — its own `children` prop is what a
  // reader sees nested inside it.
  if (typeof element.type === "string") return textContent(element.props.children);

  // A function component. Every one reachable from here — `ui/badge.tsx`,
  // `icons.tsx` — is a plain, hookless Server Component, so calling it
  // directly with its own props is exactly what rendering it does; there is
  // no state, effect, ref or context a shallow call like this could get wrong.
  if (typeof element.type === "function") {
    return textContent((element.type as (props: unknown) => ReactNode)(element.props));
  }

  return "";
}

describe("a status badge", () => {
  it.each(STATUSES)("paints %s in the ink that was measured against its own fill", (status) => {
    // `bg-status-ok text-status-gap-ink` is a plausible copy-paste and it is
    // unreadable: tokens.test.ts checks each `--status-*-ink` against *its*
    // `--status-*`, so a crossed pair ships a combination nothing measured.
    const classes = classOf(renderToStaticMarkup(<StatusBadge status={status} />));
    const fill = /\bbg-(status-[a-z]+)\b/.exec(classes)?.[1];

    expect(fill, `no bg-status-* class in "${classes}"`).toBeDefined();
    expect(classes).toContain(`text-${fill}-ink`);
  });

  it.each(STATUSES)("says what %s means in words, not only in colour", (status) => {
    // SPEC.md §3.5. Someone who cannot distinguish the fills — or is reading a
    // greyscale screenshot — still gets the whole answer.
    expect(textContent(<StatusBadge status={status} />)).toBe(statusLabel(status));
  });

  it("gives each status a glyph of its own", () => {
    const glyphs = STATUSES.map(
      (status) => /<svg[\s\S]*?<\/svg>/.exec(renderToStaticMarkup(<StatusBadge status={status} />))?.[0],
    );

    expect(new Set(glyphs).size).toBe(STATUSES.length);
  });

  it("announces the label once, not once per glyph", () => {
    const markup = renderToStaticMarkup(<StatusBadge status="unresolved" />);

    expect(/<svg[^>]*aria-hidden="true"/.test(markup)).toBe(true);
  });
});

describe("the tone vocabulary", () => {
  it("covers every status token the stylesheet declares", () => {
    // `--status-mixed` has no `LineStatus` — it belongs to the
    // "partly unverifiable" bucket of SPEC.md §3.5, which arrives with
    // `summary.ts`. It is declared, contrast-checked and therefore has to be
    // reachable, or it is a token nothing can ever paint.
    expect([...STATUS_TONES]).toEqual(["ok", "warn", "mixed", "gap", "unknown"]);
  });

  it.each(["ok", "warn", "mixed", "gap", "unknown"] as const)(
    "pairs the %s fill with its own ink",
    (tone) => {
      const classes = classOf(renderToStaticMarkup(<Badge tone={tone}>Label</Badge>));

      expect(classes).toContain(`bg-status-${tone}`);
      expect(classes).toContain(`text-status-${tone}-ink`);
    },
  );
});
