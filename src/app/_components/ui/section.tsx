import type { ReactElement, ReactNode } from "react";

/**
 * A titled block of a screen: "Add an item", "Shopping list", "Members".
 *
 * Not in SPEC.md §3.6's list, which has `PageHeader` for the h1 and
 * `CardHeader` for a card's own title but nothing for the h2 sections between
 * them. Every screen has two to four of these, and the heading is the
 * assertion `loading.tsx` makes: an `h-6` bar with `mb-3` under it. Written
 * out at each call site, that is the rule that drifts and makes the content
 * jump when it replaces its skeleton. `text-lg/6` is the `h-6`: a 1.125rem
 * heading on a 1.5rem line.
 *
 * No margin of its own. The space *between* sections belongs to whatever
 * holds them — `gap-8` on a screen, the skeletons' `mb-8` — because a margin
 * here would stack on top of any flex or grid gap around it, and the recipe
 * form puts two sections inside one.
 */
export function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg/6 font-semibold text-ink">{title}</h2>
        {description !== undefined && (
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
