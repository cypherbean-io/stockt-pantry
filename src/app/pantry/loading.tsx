import type { ReactElement } from "react";

import { Skeleton, SkeletonHeader, SkeletonRows, SkeletonScreen } from "../_components/ui/skeleton";

/**
 * `/pantry` while it loads (SPEC.md §3.7).
 *
 * Mirrors `page.tsx`: a header with a description, then the "Add an item"
 * heading and its form, then "On the shelf" and the rows. The add form is
 * above the list on the real page, so it is above it here — a skeleton that
 * put the rows first would move the form under the reader's thumb the instant
 * the data landed.
 */
export default function Loading(): ReactElement {
  return (
    <SkeletonScreen label="Loading the pantry">
      <SkeletonHeader description />

      <Skeleton className="mb-3 h-6 w-32" />
      <Skeleton className="mb-8 h-tap w-full" />

      <Skeleton className="mb-3 h-6 w-32" />
      <SkeletonRows count={4} />
    </SkeletonScreen>
  );
}
