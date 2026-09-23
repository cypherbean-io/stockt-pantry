import type { ReactElement, ReactNode } from "react";

/**
 * What a screen shows instead of nothing (SPEC.md §3.6): icon, sentence,
 * primary action.
 *
 * The action is the point. A fresh household lands on an empty `/recipes` and
 * an empty `/pantry`, and an empty state without a way out is just a smaller
 * version of the problem — so the sentence says what would have been here and
 * the button does something about it.
 */
export function EmptyState({
  icon,
  action,
  children,
}: {
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    // Dashed rather than solid: this is a placeholder for content, and the
    // border says so without any text having to.
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface-raised px-6 py-10 text-center">
      {icon !== undefined && <span className="text-2xl text-ink-muted">{icon}</span>}
      <p className="max-w-prose text-ink-muted">{children}</p>
      {action}
    </div>
  );
}
