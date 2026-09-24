import type { ReactElement } from "react";

import { SkeletonHeader, SkeletonRows, SkeletonScreen } from "../_components/ui/skeleton";

/**
 * `/recipes` while it loads (SPEC.md §3.7).
 *
 * The slowest screen in the app and the one people open first: two queries,
 * then `matchRecipe` over every recipe against the whole pantry. Two action
 * buttons and a list of rows, at the sizes `page.tsx` renders them.
 */
export default function Loading(): ReactElement {
  return (
    <SkeletonScreen label="Loading your recipes">
      <SkeletonHeader actions={2} />
      <SkeletonRows count={6} />
    </SkeletonScreen>
  );
}
