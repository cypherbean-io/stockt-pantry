"use client";

import Link from "next/link";
import type { ReactElement } from "react";

import { logOutAction } from "@/app/actions/auth";

import { ChevronDownIcon } from "./icons";
import { Button } from "./ui/button";
import { cx } from "./ui/class-names";
import { useDisclosure } from "./use-disclosure";

/**
 * The account disclosure (SPEC.md §3.3).
 *
 * It holds the two things that were previously reachable from exactly one
 * screen: the signed-in email, and Sign out — which today lives at the bottom
 * of `/household` under an `<h2>Session</h2>` and nowhere else.
 *
 * Both are behind the disclosure rather than on the bar, and that is a
 * judgement call SPEC.md §3.3 states outright: the email on the header would
 * put it in every screenshot and every over-the-shoulder glance of every page.
 * The household name is inline instead — that one is the tenant you are
 * writing to, and seeing it at all times is a safety feature (SPEC.md §4).
 *
 * The panel is rendered only while it is open, so on a page where nobody
 * touched the menu the address is not in the rendered markup — not merely
 * hidden by CSS, and so not in a screenshot.
 *
 * It *is* in the RSC flight payload of every signed-in page, because `email`
 * is a prop on a Client Component and Next serialises those into the response
 * alongside the HTML. That is inherent to handing a client component a value,
 * and it is not what SPEC.md §3.3 is guarding against: the payload is only
 * ever sent to the session it belongs to, and the threat named there is
 * someone reading the screen. Stated rather than left for whoever next greps
 * the response and finds it.
 */

export const ACCOUNT_PANEL_ID = "account-menu";

const PANEL =
  "absolute right-0 top-full z-20 mt-2 w-64 rounded-card border border-border bg-surface-raised p-2";

const ITEM =
  "flex min-h-tap w-full items-center rounded-control px-3 text-base font-medium text-ink " +
  "motion-safe:transition-colors hover:bg-surface focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-focus";

export function AccountPanel({ email }: { readonly email: string }): ReactElement {
  return (
    <div id={ACCOUNT_PANEL_ID} className={PANEL}>
      {/*
        `truncate` because an address is arbitrary length and this panel is
        anchored to the right edge of a 375px screen. The full value stays in
        the DOM, so selecting it still copies all of it.
      */}
      <p className="truncate px-3 py-2 text-sm text-ink-muted">{email}</p>
      <hr className="my-1 border-t border-border" />

      <Link href="/household" className={ITEM}>
        Household settings
      </Link>

      {/*
        A form, not a link. A GET that ends a session is followed by anything
        that follows links — a prefetch, a crawler, an email client warming a
        preview — and the user is signed out without having clicked. This posts
        the existing `logOutAction`, which already deletes the session row
        before clearing the cookie and redirects to /login. No new action.
      */}
      <form action={logOutAction}>
        <button type="submit" className={cx(ITEM, "text-left")}>
          Sign out
        </button>
      </form>
    </div>
  );
}

export function AccountMenu({ email }: { readonly email: string }): ReactElement {
  const { open, toggle, containerRef, triggerRef } = useDisclosure<HTMLDivElement>();

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-expanded={open}
        // Only while the panel exists. Pointing at an id that is not in the
        // document is a dangling reference, and the panel is conditional.
        aria-controls={open ? ACCOUNT_PANEL_ID : undefined}
        // Every glyph in `icons.tsx` is aria-hidden, because everywhere else
        // in the app one sits beside a text label. This one does not, so
        // without a name the control announces as "button".
        aria-label="Account"
      >
        <ChevronDownIcon
          className={cx("motion-safe:transition-transform", open && "rotate-180")}
        />
      </Button>

      {open && <AccountPanel email={email} />}
    </div>
  );
}
