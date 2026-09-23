"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

import { MenuIcon } from "./icons";
import { Button } from "./ui/button";
import { cx } from "./ui/class-names";
import { useDisclosure } from "./use-disclosure";

/**
 * The primary navigation (SPEC.md §3.3).
 *
 * One list, in the shell, replacing the `·`-separated line each page used to
 * hand-write — `/pantry` offered two links, `/recipes` four, `/recipes/[id]`
 * one, and none of them said where you were. The contextual links those lines
 * also carried ("Import from a URL") are not navigation; they belong to the
 * page header.
 *
 * `Nav` reads the pathname, `NavBar` takes it as a prop. The split is not
 * ceremony: `usePathname()` needs a router, so without it the active indicator
 * — the one thing here that can be subtly wrong on exactly one route — could
 * only be checked by starting a browser.
 */

export const NAV_ITEMS = [
  { href: "/recipes", label: "Recipes" },
  { href: "/pantry", label: "Pantry" },
  { href: "/household", label: "Household" },
] as const satisfies ReadonlyArray<{ href: `/${string}`; label: string }>;

export const NAV_PANEL_ID = "primary-navigation";

/**
 * Whether `href` is the section the user is in.
 *
 * A prefix match, because `/recipes/new` and `/recipes/[id]` are both inside
 * Recipes and a nav that went blank as soon as you opened a recipe would
 * answer "where am I" with nothing on most screens in the app. The separator
 * is what keeps it a path comparison rather than a string one — without it
 * `/recipes-archive` would light Recipes too.
 *
 * `null` is what `usePathname()` returns before the router has initialised.
 * Nothing is current then, which is the honest answer and, more to the point,
 * is not a crash inside the shell that wraps every page.
 */
export function isCurrent(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Base and state are kept apart rather than stacked, because `cx` is not
 * `tailwind-merge` and says so: `font-medium font-semibold` on one element is
 * decided by the order of the emitted stylesheet, not by the order they are
 * written here. Nothing in `LINK_STATE` sets a property `LINK` also sets.
 */
const LINK =
  "flex min-h-tap items-center rounded-control px-3 text-base motion-safe:transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const LINK_STATE = {
  current: "bg-surface font-semibold text-ink",
  other: "font-medium text-ink-muted hover:bg-surface hover:text-ink",
} as const;

/**
 * Below `sm` the list is a panel hanging off the button; at `sm` and above it
 * is the row of links itself. Only `hidden`/`flex` is toggled, so the `sm:`
 * rules keep the nav visible on a desktop no matter what the disclosure
 * thinks — the button that would open it is not rendered there.
 */
const PANEL =
  "absolute right-0 top-full z-20 mt-2 w-48 flex-col gap-1 rounded-card border border-border " +
  "bg-surface-raised p-2 sm:static sm:mt-0 sm:flex sm:w-auto sm:flex-row sm:gap-1 " +
  "sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0";

export function NavBar({ pathname }: { readonly pathname: string | null }): ReactElement {
  const { open, toggle, close, containerRef, triggerRef } = useDisclosure<HTMLElement>();

  return (
    <nav ref={containerRef} aria-label="Primary" className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={NAV_PANEL_ID}
        className="sm:hidden"
      >
        <MenuIcon />
        Menu
      </Button>

      <ul id={NAV_PANEL_ID} className={cx(PANEL, open ? "flex" : "hidden")}>
        {NAV_ITEMS.map(({ href, label }) => {
          const current = isCurrent(pathname, href);

          return (
            <li key={href}>
              <Link
                href={href}
                // Announced rather than merely tinted. SPEC.md §1 lists "nothing
                // indicates where you are" as a defect; a background shade alone
                // would fix it for some readers and not others.
                aria-current={current ? "page" : undefined}
                // Following a link inside the panel navigates, which on a phone
                // leaves the panel open over the page it just loaded.
                onClick={close}
                className={cx(LINK, current ? LINK_STATE.current : LINK_STATE.other)}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Nav(): ReactElement {
  return <NavBar pathname={usePathname()} />;
}
