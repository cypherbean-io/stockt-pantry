import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contrast, inSrgbGamut, parseOklch } from "./contrast";

/**
 * SPEC.md §5 "src/design/tokens.test.ts": the design tokens in
 * `src/app/globals.css`, read as text and checked as data.
 *
 * Two things are being guarded, and they are different in kind.
 *
 * The first is drift. SPEC.md §3.2 has the dark values written twice — once
 * inside `@media (prefers-color-scheme: dark)` and once for
 * `[data-theme="dark"]` — because plain CSS cannot share one declaration block
 * between a media query and a bare selector. Adding a token to one and not the
 * other produces a palette that is only half dark, and only for the users whose
 * OS disagrees with their pin. That is close to unfindable by eye, so it is a
 * test instead.
 *
 * The second is contrast. SPEC.md §2 puts the app in a kitchen on a phone, and
 * the four match statuses are the whole point of the product; a status the user
 * cannot read is a broken feature, not a cosmetic one. Every pair the UI will
 * actually paint is checked against WCAG 2.2 AA in *both* themes, because a
 * palette that passes in light and fails in dark is the normal way this goes
 * wrong.
 *
 * Reading the stylesheet as text rather than through a CSS parser follows
 * `src/packaging/packaging.test.ts`: a parser would be a new dependency for a
 * handful of assertions, and these blocks are flat lists of custom properties
 * with no nesting to get wrong.
 */

/** Comments are stripped first — several of them mention token names. */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/**
 * Exactly one match, insisted on rather than assumed.
 *
 * `exec` returns the leftmost match, and in CSS the *last* of two equally
 * specific blocks is the one that wins. So a second `:root { --ink: … }`
 * appended to the file would ship while this test went on reading the first —
 * every assertion green, about a colour that is not on the page.
 */
function matchOnce(name: string, pattern: RegExp): RegExpMatchArray {
  const all = [...css.matchAll(new RegExp(pattern.source, "g"))];
  const [first] = all;

  if (first === undefined) throw new Error(`globals.css has no ${name} block (${pattern})`);
  if (all.length > 1) {
    throw new Error(
      `globals.css has ${all.length} ${name} blocks. The later one wins the cascade; ` +
        "this file reads the first. Merge them.",
    );
  }

  return first;
}

function block(name: string, pattern: RegExp): ReadonlyMap<string, string> {
  const body = matchOnce(name, pattern)[1];
  if (body === undefined) throw new Error(`The ${name} pattern captured no body (${pattern})`);

  return new Map(
    body
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration !== "")
      .map((declaration) => {
        const colon = declaration.indexOf(":");
        if (colon === -1) throw new Error(`Not a declaration in ${name}: ${declaration}`);
        // Collapse the column alignment the stylesheet uses so two blocks that
        // differ only in whitespace still compare equal.
        return [
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).trim().replace(/\s+/g, " "),
        ] as const;
      }),
  );
}

/**
 * The custom properties of a block, dropping the plain CSS declarations that
 * sit alongside them — `color-scheme`, which is a keyword rather than a colour.
 * The drift assertions deliberately run over the *whole* block, so a
 * `color-scheme` that is set in one dark block and not the other still fails.
 */
function tokensOf(block: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  return new Map([...block].filter(([name]) => name.startsWith("--")));
}

/**
 * Returns a whole `@rule { … }` including its nested blocks, which the flat
 * `[^}]*` patterns below cannot reach.
 */
function nestedBlock(marker: string): string {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`globals.css has no ${marker}`);

  let depth = 0;
  for (let i = css.indexOf("{", start); i !== -1 && i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && (depth -= 1) === 0) return css.slice(start, i + 1);
  }

  throw new Error(`Unbalanced braces after ${marker}`);
}

/**
 * `:root` immediately followed by a brace, which `:root:not([data-theme=…])`
 * inside the media query and the `dark` variant is not — so this finds the
 * light block and only the light block.
 */
const LIGHT_PATTERN = /:root\s*\{([^}]*)\}/;

/**
 * The media-query block must be the one guarded by `:not([data-theme="light"])`.
 * Without that guard a user who pins Light on a dark OS gets dark tokens
 * anyway — row three of SPEC.md §3.2's truth table — so the selector is part of
 * what this test asserts, not just a way to find the block.
 */
const DARK_FROM_OS_PATTERN =
  /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/;

const DARK_PINNED_PATTERN = /\[data-theme="dark"\]\s*\{([^}]*)\}/;

const LIGHT = block("light :root", LIGHT_PATTERN);
const DARK_FROM_OS = block("dark @media", DARK_FROM_OS_PATTERN);
const DARK_PINNED = block("dark [data-theme]", DARK_PINNED_PATTERN);

const THEME = block("@theme inline", /@theme\s+inline\s*\{([^}]*)\}/);

/**
 * The pairs the UI paints. SPEC.md §5 names eight; the extras are here because
 * a threshold nobody measures is a threshold nobody meets:
 *
 * - `--accent` on the two surfaces, because accent is the link colour and a
 *   link is text (4.5:1).
 * - `--border-strong` on the two surfaces, because SC 1.4.11 puts a normative
 *   3:1 on the boundary of a control and a text input's border is WCAG's own
 *   example. `--border` is deliberately absent: it is a decorative divider, and
 *   SC 1.4.11 does not reach it.
 * - `--focus` on `--surface-raised` as well as `--surface`, because a focus
 *   ring lands on a card more often than on the page background.
 */
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ["--ink", "--surface", 4.5],
  ["--ink", "--surface-raised", 4.5],
  ["--ink-muted", "--surface", 4.5],
  ["--ink-muted", "--surface-raised", 4.5],
  ["--accent", "--surface", 4.5],
  ["--accent", "--surface-raised", 4.5],
  ["--accent-ink", "--accent", 4.5],
  // Non-text UI components: WCAG 2.2 SC 1.4.11 asks for 3:1, not 4.5:1.
  ["--focus", "--surface", 3],
  ["--focus", "--surface-raised", 3],
  ["--border-strong", "--surface", 3],
  ["--border-strong", "--surface-raised", 3],
  ["--status-ok-ink", "--status-ok", 4.5],
  ["--status-warn-ink", "--status-warn", 4.5],
  ["--status-mixed-ink", "--status-mixed", 4.5],
  ["--status-gap-ink", "--status-gap", 4.5],
  ["--status-unknown-ink", "--status-unknown", 4.5],
];

const THEMES = [
  ["light", LIGHT],
  ["dark, from the OS preference", DARK_FROM_OS],
  ["dark, pinned on a light OS", DARK_PINNED],
] as const;

describe("the light and dark blocks", () => {
  it("define exactly the same set of token names", () => {
    // A token added to one block and not the others is a colour that silently
    // keeps its light value in dark mode.
    const light = [...LIGHT.keys()].sort();

    expect([...DARK_FROM_OS.keys()].sort()).toEqual(light);
    expect([...DARK_PINNED.keys()].sort()).toEqual(light);
  });

  it("give the two dark blocks identical values", () => {
    // These two exist only because CSS cannot share a declaration block between
    // a media query and a bare selector. They are one palette written twice, so
    // any difference between them is a mistake by definition.
    expect(Object.fromEntries(DARK_PINNED)).toEqual(Object.fromEntries(DARK_FROM_OS));
  });

  it("actually change colour between light and dark", () => {
    // Guards the copy-paste failure where the dark blocks are duplicated from
    // the light one and never edited.
    for (const [name, value] of LIGHT) {
      expect(DARK_FROM_OS.get(name), `${name} is the same in both themes`).not.toBe(value);
    }
  });

  it("put the pinned-dark block after :root, which is what lets it win", () => {
    // `:root` and `[data-theme="dark"]` are both specificity (0,1,0). Nothing
    // but source order decides between them, so "pinned dark on a light OS"
    // — row four of SPEC.md §3.2's truth table — works *only* while the
    // attribute block comes last. Swap them and the app silently renders light
    // with every other assertion in this file still green.
    const light = matchOnce("light :root", LIGHT_PATTERN).index ?? -1;
    const pinned = matchOnce("dark [data-theme]", DARK_PINNED_PATTERN).index ?? -1;

    expect(pinned).toBeGreaterThan(light);
  });
});

describe("the dark: variant", () => {
  const variant = nestedBlock("@custom-variant dark");

  it("fires in both of the cases the token cascade goes dark", () => {
    // A `dark:` utility has to agree with the tokens. The obvious one-line
    // definition matches only `[data-theme="dark"]`, and SPEC.md §3.3 leaves
    // that attribute off entirely for the default "system" theme — so on a
    // dark-preference OS the tokens would go dark while every `dark:` utility
    // stayed light, for exactly the users who never touch the toggle.
    expect(variant).toContain("prefers-color-scheme: dark");
    expect(variant).toContain(':root:not([data-theme="light"])');
    expect(variant).toContain('[data-theme="dark"]');
  });
});

describe.each(THEMES)("%s", (_label, tokens) => {
  it("declares every token as a colour that sRGB can display", () => {
    // An out-of-gamut oklch() is clipped by the browser, so the colour that
    // ships is not the one that was measured here.
    for (const [name, value] of tokensOf(tokens)) {
      const colour = parseOklch(value);
      expect(inSrgbGamut(colour), `${name}: ${value} is outside sRGB`).toBe(true);
    }
  });

  it.each(PAIRS)("meets WCAG AA with %s on %s (>= %s:1)", (foreground, background, minimum) => {
    const fg = tokens.get(foreground);
    const bg = tokens.get(background);
    if (fg === undefined || bg === undefined) {
      throw new Error(`globals.css does not declare ${fg === undefined ? foreground : background}`);
    }

    expect(contrast(parseOklch(fg), parseOklch(bg))).toBeGreaterThanOrEqual(minimum);
  });
});

describe("@theme inline", () => {
  it("maps every colour token to the --color-* key that generates its utilities", () => {
    // Identity, not membership. Checking only that each token appears
    // *somewhere* in this block passes a transposition —
    //   --color-surface: var(--ink);
    //   --color-ink:     var(--surface);
    // — which paints ink where surface should be at a 1:1 ratio, with every
    // contrast assertion above still green because they read the `:root` block
    // and never look here.
    for (const name of tokensOf(LIGHT).keys()) {
      expect(
        THEME.get(`--color-${name.slice(2)}`),
        `@theme inline does not map ${name} to --color-${name.slice(2)}`,
      ).toBe(`var(${name})`);
    }
  });

  it("maps them under Tailwind's --color-* namespace", () => {
    // `--color-surface` is what makes `bg-surface` exist; `--surface` on its own
    // generates no utility at all.
    for (const [name, value] of THEME) {
      if (!/var\(--/.test(value)) continue;
      expect(name.startsWith("--color-"), `${name} maps a colour but is not a --color-* key`).toBe(
        true,
      );
    }
  });
});
