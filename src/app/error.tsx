"use client";

import type { ReactElement } from "react";

import { Button } from "./_components/ui/button";
import { PageHeader } from "./_components/ui/page-header";

/**
 * The route-level error boundary (SPEC.md §3.7). `"use client"` because Next
 * requires it of one; it wraps every page under the root layout, so the shell
 * — navigation, household name, sign out — is still there around this.
 *
 * **It must never render anything off the error object but `digest`.**
 * CLAUDE.md: a `DrizzleQueryError` formats as
 * `Failed query: <sql>\nparams: <bound values>`, and that string now carries
 * password hashes, invite token hashes and whole recipes — which SPEC.md §4
 * keeps out of the logs just as firmly as off the screen. `src/db/redact.ts`
 * strips driver errors at the query layer; this is the last place an
 * unredacted error from anywhere else could surface, and in development Next
 * forwards the original message here verbatim, so "production redacts it" is
 * not the guarantee.
 *
 * Hence the signature: the `error` prop is destructured to `digest` where it
 * arrives, and the component body never binds `error` at all. `error.message`
 * is not merely unwritten here — there is no `error` in scope to write it off.
 * `packaging.test.ts` checks the spelling and `route-states.test.tsx` renders
 * a deliberately leaky error and checks the behaviour; this is the third guard
 * and the only one that does not depend on someone reading a test.
 *
 * There is also no `console.error(error)`, which is what Next's own example
 * does. On the client that writes the same string to the browser console, and
 * the server has already logged the thing it is a copy of.
 *
 * `retry` rather than `reset` — Next 16.3 made it stable and its docs prefer
 * it. `reset` clears the boundary without re-fetching, which for a page whose
 * every failure mode is a query would re-render the same failure.
 */
export default function ErrorScreen({
  error: { digest },
  retry,
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}): ReactElement {
  return (
    <>
      <PageHeader
        title="Something went wrong"
        description="This page could not be loaded. Trying again is usually enough."
      />

      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={() => retry()}>Try again</Button>

        {digest !== undefined && (
          <p className="text-sm text-ink-muted">
            {/*
              The only thing said about the failure, and it says nothing about
              it: a hash Next also wrote to the server log, so an operator can
              find the one line that matches without the reader ever seeing it.
            */}
            Reference <code className="font-mono text-ink">{digest}</code>
          </p>
        )}
      </div>
    </>
  );
}
