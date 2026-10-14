import type { ReactElement } from "react";

import { Skeleton, SkeletonHeader, SkeletonRows, SkeletonScreen } from "../_components/ui/skeleton";

/**
 * `/recipes` while it loads (SPEC.md §3.7).
 *
 * The slowest screen in the app and the one people open first: two queries,
 * then `matchRecipe` over every recipe against the whole pantry. Two action
 * buttons, then the recipes grouped under their buckets (SPEC.md §2 item 6),
 * at the sizes `recipe-list-screen.tsx` renders them: an `h-7` heading — the
 * bucket badge, `text-sm` on a 1.25rem line plus `py-1` — `mb-3` above its
 * rows, and `gap-8` between groups. Two groups, because how many buckets a
 * household has is not known until the match has run.
 */
export default function Loading(): ReactElement {
  return (
    <SkeletonScreen label="Loading your recipes">
      <SkeletonHeader actions={2} />
      <div className="flex flex-col gap-8">
        {[3, 3].map((rows, index) => (
          // Positional keys: identical placeholders, never reordered.
          <div key={index}>
            <Skeleton className="mb-3 h-7 w-40" />
            <SkeletonRows count={rows} />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
