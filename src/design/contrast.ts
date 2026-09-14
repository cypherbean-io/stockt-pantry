/**
 * `oklch()` → sRGB → WCAG 2.2 contrast ratio, in about a hundred lines.
 *
 * SPEC.md §5 requires `src/design/tokens.test.ts` to prove the palette in
 * `globals.css` meets AA in both themes. The tokens are written in `oklch()`
 * because that is the space in which a light and a dark ramp can be authored
 * with predictable lightness steps — but nothing in the `unit` Vitest project
 * can evaluate a CSS colour. The alternatives were a colour-science dependency
 * (CLAUDE.md: do not add one without asking, and this is a handful of matrix
 * multiplications) or a browser (which would make an accessibility check
 * conditional on Playwright being installed, and SPEC.md §5 keeps the pure
 * project free of both Docker and browsers). So: ours, and tested against
 * values that come from outside it.
 *
 * Deliberately *not* a general colour library. It reads the one notation the
 * tokens use, refuses everything else, and it has no clamping anywhere — a
 * colour that sRGB cannot show is an error, not something to quietly move.
 *
 * Pure, no React, no DOM: this is why it sits in `src/design/` rather than
 * under `src/app/`.
 */

export type Oklch = {
  /** 0–1, not a percentage — `oklch(50% …)` parses to `0.5`. */
  readonly l: number;
  readonly c: number;
  /** Degrees. */
  readonly h: number;
};

/** Gamma-encoded sRGB, nominally 0–1. Values outside that range are out of gamut. */
export type Srgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/**
 * Accepts `oklch(L C H)` with L as a percentage or as a 0–1 number, and an
 * optional `deg` on the hue. Everything else — hex, `rgb()`, `var()`, a missing
 * channel — throws, because the caller is a guard test: a parser that returned
 * a default for something it did not understand would report an unchecked
 * token as a passing one.
 */
/**
 * `[0-9]*\.?[0-9]+` would be the obvious spelling and is ambiguous: `\.?` can
 * match empty, so every way of splitting a run of digits between the two
 * character classes is a separate path for the engine to try, and a long
 * non-matching run costs O(n²). The input is a file in this repo today, but the
 * module is exported and the fix is free.
 */
const NUMBER = String.raw`(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)`;

const OKLCH = new RegExp(
  String.raw`^oklch\(\s*(${NUMBER})(%?)\s+(${NUMBER})\s+(-?${NUMBER})(?:deg)?\s*\)$`,
);

export function parseOklch(css: string): Oklch {
  const text = css.trim();

  // Checked before the shape match so the failure names the actual problem. A
  // translucent token composites against whatever is painted behind it, so its
  // contrast against a named background is not a number this module can know;
  // dropping the alpha would answer a question that was not asked.
  if (/^oklch\(.*\//.test(text)) {
    throw new Error(`Colour has an alpha channel, whose contrast is not decidable here: ${css}`);
  }

  const match = OKLCH.exec(text);
  if (match === null) throw new Error(`Not an oklch() colour: ${css}`);

  const [, lightness, percent, chroma, hue] = match;
  // No default values here on purpose. `Number("")` is 0, and 0 passes the
  // range check below, so a default would turn a future regex change that made
  // a group optional into a silent `oklch(0% 0 0)` — black, maximum contrast,
  // every guard green. None of these groups is optional today; if that ever
  // stops being true this throws rather than lies.
  if (lightness === undefined || chroma === undefined || hue === undefined) {
    throw new Error(`Incomplete oklch() colour: ${css}`);
  }

  const l = percent === "%" ? Number(lightness) / 100 : Number(lightness);

  // CSS would clamp these. In a token file an out-of-range channel is a typo,
  // and clamping it turns the typo into a colour nobody chose.
  if (l < 0 || l > 1) throw new Error(`Lightness outside 0–100%: ${css}`);

  return { l, c: Number(chroma), h: Number(hue) };
}

/**
 * OKLab → linear sRGB (Björn Ottosson's matrices). Unclamped: a negative or
 * greater-than-one component is the signal that the colour is outside the
 * sRGB gamut, and `inSrgbGamut` depends on it surviving to be seen.
 */
function toLinearSrgb({ l, c, h }: Oklch): Srgb {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    g: -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    b: -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  };
}

/**
 * The sRGB transfer function, applied around zero so a negative linear
 * component keeps its sign instead of becoming NaN. Losing the sign would hide
 * exactly the out-of-gamut case this module has to report.
 */
function encode(channel: number): number {
  const magnitude = Math.abs(channel);
  const encoded = magnitude <= 0.0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return Math.sign(channel) * encoded;
}

function decode(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function toSrgb(colour: Oklch): Srgb {
  const linear = toLinearSrgb(colour);
  return { r: encode(linear.r), g: encode(linear.g), b: encode(linear.b) };
}

/**
 * The matrix arithmetic lands white on 1.0000000000000002 rather than 1, so a
 * bare `<= 1` would declare `oklch(100% 0 0)` unrenderable. The tolerance is
 * far below one 8-bit step (1/255 ≈ 0.0039), so it cannot admit a colour that
 * would actually clip.
 */
const GAMUT_EPSILON = 1e-6;

export function inSrgbGamut(colour: Oklch): boolean {
  return Object.values(toSrgb(colour)).every(
    (channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON,
  );
}

/** 0–255 per channel, as a browser would rasterise it. Throws when out of gamut. */
function toChannels(colour: Oklch): readonly [number, number, number] {
  const { r, g, b } = toSrgb(colour);

  if (!inSrgbGamut(colour)) {
    throw new Error(
      "Colour is outside the sRGB gamut and would be clipped by the display: " +
        `oklch(${colour.l * 100}% ${colour.c} ${colour.h}) → rgb(${r} ${g} ${b})`,
    );
  }

  // The clamp only ever absorbs the sub-epsilon overshoot `inSrgbGamut` just
  // allowed; anything larger threw above.
  const quantise = (channel: number): number =>
    Math.min(255, Math.max(0, Math.round(channel * 255)));

  return [quantise(r), quantise(g), quantise(b)];
}

export function toHex(colour: Oklch): string {
  return `#${toChannels(colour)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * WCAG 2.2 relative luminance, computed from the 8-bit channels rather than
 * from the continuous OKLab values. Quantisation is what a display actually
 * shows, and near the 4.5 threshold the two answers can straddle it.
 */
export function relativeLuminance(colour: Oklch): number {
  const [r, g, b] = toChannels(colour);
  return 0.2126 * decode(r / 255) + 0.7152 * decode(g / 255) + 0.0722 * decode(b / 255);
}

/**
 * WCAG 2.2 contrast ratio, 1–21. Symmetric by construction: the formula orders
 * the pair by luminance, so a foreground/background mix-up at a call site
 * cannot change the verdict.
 */
export function contrast(a: Oklch, b: Oklch): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}
