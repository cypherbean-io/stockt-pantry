import { describe, expect, it } from "vitest";

import { contrast, inSrgbGamut, parseOklch, toHex, toSrgb } from "./contrast";

/**
 * SPEC.md §5 "src/design/contrast.test.ts".
 *
 * This module exists for one reason: `tokens.test.ts` has to decide whether the
 * palette in `globals.css` meets WCAG 2.2 AA, and the tokens are written in
 * `oklch()` — a colour space no runtime in the `unit` project can evaluate. A
 * browser could, but that would make an accessibility check depend on a browser
 * being installed, which is exactly the dependency SPEC.md §5 keeps the pure
 * project free of.
 *
 * So the conversion is ours, and it is tested against values that come from
 * outside it: the two sRGB endpoints, the fixed 21:1 ceiling, and the grey
 * WCAG's own documentation uses as the smallest passing foreground on white.
 */

const WHITE = parseOklch("oklch(100% 0 0)");
const BLACK = parseOklch("oklch(0% 0 0)");

/**
 * `#767676` is the canonical WCAG boundary grey — the darkest text colour that
 * still fails AA against white if you go one step lighter. Its published ratio
 * against white is 4.54:1, which is the number this file checks against, so the
 * expectation does not come from the implementation being tested.
 */
const BOUNDARY_GREY = parseOklch("oklch(56.58% 0 0)");

describe("parseOklch", () => {
  it("reads lightness as a percentage and as the equivalent 0–1 number", () => {
    // CSS permits both spellings for the L channel. The tokens use percentages;
    // accepting the other form costs nothing and stops a future edit that
    // writes `oklch(1 0 0)` from being silently misread as 1% lightness.
    expect(parseOklch("oklch(50% 0.1 260)")).toEqual({ l: 0.5, c: 0.1, h: 260 });
    expect(parseOklch("oklch(0.5 0.1 260)")).toEqual({ l: 0.5, c: 0.1, h: 260 });
  });

  it("tolerates the whitespace a stylesheet actually contains", () => {
    // globals.css aligns its values in columns, so the parser sees runs of
    // spaces rather than single ones.
    expect(parseOklch("  oklch(99%  0.002  260)  ")).toEqual({ l: 0.99, c: 0.002, h: 260 });
  });

  it("rejects a colour it cannot evaluate rather than guessing at one", () => {
    // Silently returning black for an unparseable token would report a
    // contrast failure as a pass wherever the token is a background.
    for (const bad of ["#b00020", "rgb(176 0 32)", "oklch(50% 0.1)", "var(--ink)", ""]) {
      expect(() => parseOklch(bad)).toThrow();
    }
  });

  it("rejects an alpha channel instead of dropping it", () => {
    // A translucent token composites against whatever is behind it, so its
    // contrast against a named background is not the number this module would
    // compute. Refusing is honest; ignoring the `/ 0.5` is not.
    expect(() => parseOklch("oklch(50% 0.1 260 / 0.5)")).toThrow(/alpha/i);
  });
});

describe("toHex", () => {
  it("maps the two sRGB endpoints exactly", () => {
    expect(toHex(WHITE)).toBe("#ffffff");
    expect(toHex(BLACK)).toBe("#000000");
  });

  it("round-trips the WCAG boundary grey to the hex it is documented as", () => {
    expect(toHex(BOUNDARY_GREY)).toBe("#767676");
  });
});

describe("sRGB gamut", () => {
  /** Far outside sRGB: no display-P3-class green is reachable in 8-bit sRGB. */
  const TOO_GREEN = parseOklch("oklch(60% 0.4 140)");

  it("reports an out-of-gamut colour rather than clipping it into range", () => {
    // Clipping would hand back a colour nobody wrote, and then measure *its*
    // contrast — a green that renders differently from the number this module
    // approved. A token that cannot be displayed is a bug in the token.
    expect(inSrgbGamut(TOO_GREEN)).toBe(false);
    expect(() => toHex(TOO_GREEN)).toThrow(/gamut/i);

    const { r, g, b } = toSrgb(TOO_GREEN);
    expect(Math.min(r, g, b) < 0 || Math.max(r, g, b) > 1).toBe(true);
  });

  it("accepts the colours that are inside it", () => {
    expect(inSrgbGamut(WHITE)).toBe(true);
    expect(inSrgbGamut(BLACK)).toBe(true);
    expect(inSrgbGamut(parseOklch("oklch(52% 0.16 258)"))).toBe(true);
  });
});

describe("contrast", () => {
  it("reaches the fixed 21:1 ceiling for black on white", () => {
    expect(contrast(WHITE, BLACK)).toBe(21);
  });

  it("bottoms out at 1:1 for a colour against itself", () => {
    for (const colour of [WHITE, BLACK, BOUNDARY_GREY]) {
      expect(contrast(colour, colour)).toBe(1);
    }
  });

  it("does not depend on which colour is named first", () => {
    // WCAG's formula orders the pair by luminance, so a foreground/background
    // mix-up at a call site must not change the verdict.
    expect(contrast(WHITE, BOUNDARY_GREY)).toBe(contrast(BOUNDARY_GREY, WHITE));
  });

  it("agrees with the published ratio for the WCAG boundary grey on white", () => {
    expect(contrast(BOUNDARY_GREY, WHITE)).toBeCloseTo(4.54, 2);
  });

  it("puts that grey on the passing side of AA and one step lighter on the failing side", () => {
    // The point of the boundary: 4.5 is a threshold the module has to resolve
    // correctly, not approximately.
    expect(contrast(BOUNDARY_GREY, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseOklch("oklch(58% 0 0)"), WHITE)).toBeLessThan(4.5);
  });
});
