import type { ReactElement, ReactNode } from "react";

import { cx } from "./class-names";

/**
 * The placeholders behind every `loading.tsx` in the app (SPEC.md §3.7).
 *
 * A skeleton is not a spinner. SPEC.md asks these to "mirror the real layout's
 * dimensions so nothing jumps when the content arrives", which means the sizes
 * below are the assertion — a bar that is the wrong height is the layout shift
 * this exists to prevent, wearing the costume of a fix.
 *
 * Two decisions are shared by all of them:
 *
 * - **The bars are `aria-hidden` and the screen announces once.** A dozen
 *   unlabelled boxes in a live region is a dozen announcements of nothing.
 *   `SkeletonScreen` names what is loading and hides everything under it.
 * - **`motion-safe:animate-pulse`, never a bare `animate-pulse`.** SPEC.md
 *   §2.12 puts every animation in this app behind `prefers-reduced-motion`,
 *   and a pulse that ignores it is on screen for exactly as long as the page
 *   is slow — which is when someone sensitive to it is least able to leave.
 *
 * Not in §3.9's file list, which names only the four `loading.tsx`. It is here
 * because those four would otherwise hold four copies of both decisions above,
 * and a rule kept in four places is a rule that drifts.
 */

const BAR = "block rounded-control bg-border motion-safe:animate-pulse";

export function Skeleton({ className }: { readonly className?: string }): ReactElement {
  return <span aria-hidden="true" className={cx(BAR, className)} />;
}

export function SkeletonScreen({
  label,
  children,
}: {
  /** What is loading, in words. The only thing here a screen reader says. */
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    // `role="status"` rather than `aria-live="polite"` spelled out: it carries
    // the same politeness plus `aria-atomic`, so the label is announced whole
    // rather than word by word as the region appears.
    <div role="status">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * The block `PageHeader` will occupy: the same `mb-6`, and an `h-8` bar for an
 * `h1` that renders at `text-2xl`. `description` and `actions` mirror the two
 * optional halves of the real component, so a page that has them does not gain
 * a header's worth of height the moment it arrives.
 */
export function SkeletonHeader({
  description = false,
  actions = 0,
}: {
  readonly description?: boolean;
  readonly actions?: number;
} = {}): ReactElement {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <Skeleton className="h-8 w-48" />
        {description && <Skeleton className="mt-1 h-6 w-64" />}
      </div>
      {actions > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: actions }, (_, index) => (
            // Positional keys: these are identical, interchangeable and never
            // reordered — there is no identity here to preserve.
            <Skeleton key={index} className="h-tap w-32" />
          ))}
        </div>
      )}
    </div>
  );
}

/** A table body or a list, at one thumb-sized row each. */
export function SkeletonRows({
  count,
  className,
}: {
  readonly count: number;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-tap w-full" />
      ))}
    </div>
  );
}
