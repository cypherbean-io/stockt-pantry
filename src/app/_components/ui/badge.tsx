import type { ComponentType, ReactElement, ReactNode } from "react";

import { BUCKET_LABEL, type RecipeBucket } from "@/lib/matching/summary";
import type { LineStatus } from "@/lib/matching/types";

import { CheckIcon, DiamondIcon, HalfCircleIcon, HalfDiamondIcon, MinusCircleIcon } from "../icons";
import { cx } from "./class-names";

/**
 * Where a match status becomes something you can see (SPEC.md §3.5, §3.6).
 *
 * The rule the whole file exists to keep: a status is a token *and* a glyph
 * *and* a text label, never fewer. The four statuses are the central
 * distinction in this app and each has a different fix — "missing" and "short"
 * are answered by buying something, "unresolved" by knowing a density — so a
 * user who cannot tell them apart cannot tell what to go and do. Anyone
 * reading a greyscale screenshot, or not distinguishing the fills, still gets
 * the whole answer.
 *
 * `Badge` is the visual primitive and `StatusBadge` is the one the app calls.
 * `StatusBadge` paints two vocabularies: a line's `LineStatus`, and the
 * `RecipeBucket` `/recipes` groups a whole recipe under (SPEC.md §3.5, §3.6).
 * They share no strings, so one prop takes either. Only a bucket reaches
 * `--status-mixed` — Partly unverifiable — which no single line can be.
 */

export const STATUS_TONES = ["ok", "warn", "mixed", "gap", "unknown"] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/**
 * Each fill with the ink that was measured against it. `src/design/
 * tokens.test.ts` checks every `--status-*-ink` against *its own* `--status-*`
 * at 4.5:1, so a crossed pair here — `bg-status-ok text-status-gap-ink` — is a
 * combination nothing has measured and, in dark mode, close to invisible.
 */
const TONE: Record<StatusTone, string> = {
  ok: "bg-status-ok text-status-ok-ink",
  warn: "bg-status-warn text-status-warn-ink",
  mixed: "bg-status-mixed text-status-mixed-ink",
  gap: "bg-status-gap text-status-gap-ink",
  unknown: "bg-status-unknown text-status-unknown-ink",
};

const BADGE = "inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-sm font-medium";

export function Badge({
  tone,
  icon,
  className,
  children,
}: {
  readonly tone: StatusTone;
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className={cx(BADGE, TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

type Glyph = ComponentType<{ readonly className?: string }>;

/**
 * Everything a status is drawn with, in one total `Record`: a fifth line
 * status or bucket fails `tsc` here until it has a tone, a glyph and words.
 *
 * The line words moved here from `_components/match.tsx` because this is what
 * paints them, and a second copy of a user-visible string is a copy that
 * drifts. The bucket words are `BUCKET_LABEL`'s for the same reason — they
 * are the headings `/recipes` groups under. Glyphs and tones follow SPEC.md
 * §3.5's table: a bucket that stands for a single line status borrows its
 * glyph, and the two that roll several together get shapes of their own.
 */
const STATUS: Record<
  LineStatus | RecipeBucket,
  { readonly tone: StatusTone; readonly Glyph: Glyph; readonly label: string }
> = {
  have: { tone: "ok", Glyph: CheckIcon, label: "have enough" },
  short: { tone: "warn", Glyph: HalfCircleIcon, label: "short" },
  missing: { tone: "gap", Glyph: MinusCircleIcon, label: "missing" },
  unresolved: { tone: "unknown", Glyph: DiamondIcon, label: "can't verify without a density" },

  ready: { tone: "ok", Glyph: CheckIcon, label: BUCKET_LABEL.ready },
  shopping: { tone: "warn", Glyph: HalfCircleIcon, label: BUCKET_LABEL.shopping },
  "partly-unverifiable": {
    tone: "mixed",
    Glyph: HalfDiamondIcon,
    label: BUCKET_LABEL["partly-unverifiable"],
  },
  unverifiable: { tone: "unknown", Glyph: DiamondIcon, label: BUCKET_LABEL.unverifiable },
};

export function statusLabel(status: LineStatus | RecipeBucket): string {
  return STATUS[status].label;
}

export function StatusBadge({
  status,
  className,
}: {
  readonly status: LineStatus | RecipeBucket;
  readonly className?: string;
}): ReactElement {
  const { tone, Glyph, label } = STATUS[status];

  return (
    <Badge tone={tone} icon={<Glyph className="shrink-0" />} className={className}>
      {label}
    </Badge>
  );
}
