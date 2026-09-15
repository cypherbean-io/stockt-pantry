import type { ReactElement, ReactNode } from "react";

/**
 * The top of every screen (SPEC.md §3.6): title, description, action slot.
 *
 * The action slot is where the contextual links go once SPEC.md §3.3 deletes
 * the `·`-separated line each page currently hand-writes. Those lines disagree
 * with each other — `/pantry` offers two, `/recipes` four, `/recipes/[id]` one
 * — because there was nowhere for them to live; navigation moves to the shell
 * and what is left ("Import from a URL") belongs to the page, here.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    // The page's one h1. Everything below it starts at h2, which is what makes
    // the default h3 in `CardHeader` correct.
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 max-w-prose text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}
