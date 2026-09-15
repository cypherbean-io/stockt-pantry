import type { ReactElement } from "react";

/**
 * The glyph set, hand-rolled (SPEC.md §3.6).
 *
 * No icon package: `lucide-react` and friends ship a thousand glyphs so that
 * nine can be used, and SPEC.md §3.10 already refused that trade once for
 * `shadcn/ui`. These are the nine-ish the app actually draws, and the list only
 * grows when a screen needs one.
 *
 * Three decisions are shared by all of them, in `GRID`:
 *
 * - `aria-hidden`. Every glyph in this app sits beside a text label, because
 *   SPEC.md §3.5 does not let colour — or a shape — carry meaning alone.
 *   Exposing the SVG as well would announce the status twice.
 * - `currentColor`. A glyph inherits the status token of the badge it is in, so
 *   it changes with the theme and is covered by the contrast pairs in
 *   `src/design/tokens.test.ts`. A literal here would be neither.
 * - `1em` on a 16-unit grid, so a glyph scales with the text beside it rather
 *   than needing a size class at every call site.
 */

type IconProps = { readonly className?: string };

const GRID = {
  viewBox: "0 0 16 16",
  width: "1em",
  height: "1em",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
} as const;

/** The half-filled glyphs paint their fill with a second, strokeless path. */
const FILLED = { fill: "currentColor", stroke: "none" } as const;

/** `have` — the recipe line is satisfied. */
export function CheckIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

/** `short` — some of it is in the pantry, hence a part-filled circle. */
export function HalfCircleIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path {...FILLED} d="M2.5 8a5.5 5.5 0 0 0 11 0Z" />
    </svg>
  );
}

/** `missing` — none of it is there. */
export function MinusCircleIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5 8h6" />
    </svg>
  );
}

/** `unresolved` — the data cannot answer, which is not the same as "no". */
export function DiamondIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" />
    </svg>
  );
}

/**
 * The "partly unverifiable" bucket: part of the answer is known and part is
 * not. It is the diamond rather than a third circle because its neighbour
 * `--status-mixed` sits 25 degrees from `--status-warn` on purpose — the shape
 * is what tells them apart, not the hue.
 */
export function HalfDiamondIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" />
      <path {...FILLED} d="M8 2.5 13.5 8 8 13.5Z" />
    </svg>
  );
}

/** Add a recipe, add a pantry item, add an ingredient line. */
export function PlusIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/** The navigation disclosure below `sm` (SPEC.md §3.3). */
export function MenuIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

/** The account disclosure. Rotate it at the call site if it needs to point up. */
export function ChevronDownIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

/** Theme: pinned light. */
export function SunIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06" />
    </svg>
  );
}

/** Theme: pinned dark. */
export function MoonIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
    </svg>
  );
}

/** Theme: follow the system. Split down the middle rather than sun-or-moon. */
export function ContrastIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...GRID} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path {...FILLED} d="M8 2.5v11a5.5 5.5 0 0 0 0-11Z" />
    </svg>
  );
}
