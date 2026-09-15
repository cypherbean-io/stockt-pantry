import type { ComponentType, ReactElement, ReactNode } from "react";

import type { LineStatus } from "@/lib/matching/types";

import { CheckIcon, DiamondIcon, HalfCircleIcon, MinusCircleIcon } from "../icons";
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
 * They are separate because the four *buckets* of SPEC.md §3.5 need the same
 * chip over a different vocabulary, including `--status-mixed`, which no
 * `LineStatus` maps to. That bucket badge arrives with `src/lib/matching/
 * summary.ts`; until then `STATUS_TONES` is what keeps the token reachable and
 * covered.
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

/**
 * The words, which moved here from `_components/match.tsx` because this is
 * what paints them and a second copy of a user-visible string is a copy that
 * drifts.
 */
const STATUS_LABEL: Record<LineStatus, string> = {
  have: "have enough",
  short: "short",
  missing: "missing",
  unresolved: "can't verify without a density",
};

export function statusLabel(status: LineStatus): string {
  return STATUS_LABEL[status];
}

const STATUS_TONE: Record<LineStatus, StatusTone> = {
  have: "ok",
  short: "warn",
  missing: "gap",
  unresolved: "unknown",
};

const STATUS_ICON: Record<LineStatus, ComponentType<{ readonly className?: string }>> = {
  have: CheckIcon,
  short: HalfCircleIcon,
  missing: MinusCircleIcon,
  unresolved: DiamondIcon,
};

export function StatusBadge({
  status,
  className,
}: {
  readonly status: LineStatus;
  readonly className?: string;
}): ReactElement {
  const Glyph = STATUS_ICON[status];

  return (
    <Badge tone={STATUS_TONE[status]} icon={<Glyph className="shrink-0" />} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}
