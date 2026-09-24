import type { ReactElement } from "react";

import { Skeleton, SkeletonHeader, SkeletonRows, SkeletonScreen } from "../../_components/ui/skeleton";

/**
 * One recipe while it loads (SPEC.md §3.7): the title, the servings control,
 * the match table, and the shopping list under it.
 *
 * **This route gives up its 404 status code, knowingly.** A `loading.tsx` puts
 * a Suspense boundary above the page, so Next flushes the response as soon as
 * this fallback renders — which is before `page.tsx` has awaited the query
 * that decides whether the recipe exists. The headers are gone by the time
 * `notFound()` runs, so an unknown id answers HTTP 200 carrying the 404 page,
 * with `<meta name="robots" content="noindex">` that Next adds for exactly
 * this case. Next's own `loading.js` reference documents the trade and the way
 * out: check existence before the body streams.
 *
 * Taken anyway. Nothing crawls a self-hosted household pantry behind a login,
 * no caller reads the status, and the property that actually matters here is
 * untouched — an unknown id and another household's recipe still render the
 * identical page, which is the thing `page.tsx` deliberately does not
 * distinguish. The alternative was to leave the slowest single-recipe render
 * in the app with no loading state at all.
 */
export default function Loading(): ReactElement {
  return (
    <SkeletonScreen label="Loading this recipe">
      <SkeletonHeader />

      {/* "Can I make this?", then the servings field and its Rescale button. */}
      <Skeleton className="mb-3 h-6 w-40" />
      <Skeleton className="mb-8 h-tap w-64" />

      <SkeletonRows count={5} />

      {/* Shopping list. */}
      <Skeleton className="mt-8 mb-3 h-6 w-40" />
      <SkeletonRows count={2} />
    </SkeletonScreen>
  );
}
