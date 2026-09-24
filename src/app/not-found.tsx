import type { ReactElement } from "react";

import { MinusCircleIcon } from "./_components/icons";
import { LinkButton } from "./_components/ui/button";
import { EmptyState } from "./_components/ui/empty-state";
import { PageHeader } from "./_components/ui/page-header";

/**
 * The 404 (SPEC.md §3.7). It renders inside the root layout, so it arrives
 * wearing the shell — the reader is not dropped onto a bare framework page
 * with no way back.
 *
 * **The copy must not say why.** `/recipes/[id]` sends an unknown id and
 * another household's recipe to the same `notFound()` deliberately: guessing
 * an id must not be a way to learn that it is real. A page that said "you do
 * not have permission" would give that away in prose, for free, no matter how
 * carefully the query layer was written.
 *
 * What actually guarantees that is the signature: Next hands a `not-found.tsx`
 * no props at all, so this component has no input that could differ between
 * the two cases and cannot vary its output by them even if the copy tried to.
 * The word list in `route-states.test.tsx` is a tripwire for a future rewrite,
 * not the proof — it can only catch the phrasings someone thought to list.
 * Keep this component propless and the property holds by construction.
 *
 * This file also answers every URL that matches no route at all, including for
 * a signed-out visitor — "Back to recipes" then lands on `/login`, which is
 * the same place every other link would take them.
 *
 * `MinusCircleIcon` is the `missing` glyph from the status set. Borrowed
 * rather than drawn: it already means "none of it is there", which is the
 * whole message here, and SPEC.md §3.6 only grows the icon set for a screen
 * that actually needs a new shape.
 */
export default function NotFound(): ReactElement {
  return (
    <>
      <PageHeader title="Not found" />

      <EmptyState
        icon={<MinusCircleIcon />}
        action={<LinkButton href="/recipes">Back to recipes</LinkButton>}
      >
        There is nothing at this address. The link may be wrong, or what it pointed at may be gone.
      </EmptyState>
    </>
  );
}
