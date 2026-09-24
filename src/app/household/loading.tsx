import type { ReactElement } from "react";

import { Skeleton, SkeletonHeader, SkeletonRows, SkeletonScreen } from "../_components/ui/skeleton";

/**
 * `/household` while it loads (SPEC.md §3.7): the household name and the
 * signed-in address, then Members, then Invites and the button that issues
 * one.
 *
 * Three queries deep — `findHousehold`, `listMembers`, `listInvites` — and the
 * shell above it has already run a fourth of its own.
 */
export default function Loading(): ReactElement {
  return (
    <SkeletonScreen label="Loading your household">
      <SkeletonHeader description />

      <Skeleton className="mb-3 h-6 w-28" />
      <SkeletonRows count={2} />

      <Skeleton className="mt-8 mb-3 h-6 w-28" />
      <Skeleton className="mb-3 h-tap w-40" />
      <SkeletonRows count={2} />
    </SkeletonScreen>
  );
}
