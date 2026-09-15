import type { ReactElement, ReactNode } from "react";

import { cx } from "./class-names";

/**
 * The raised surface (SPEC.md §3.6) — and, below `sm`, what every table in the
 * app collapses into. Not `overflow-x: auto`: a horizontally scrolling table
 * on a phone in a kitchen is not a fix.
 */

const CARD = "rounded-card border border-border bg-surface-raised p-4";

export function Card({
  as = "div",
  className,
  children,
}: {
  /**
   * A stack of collapsed table rows is a list, and a `<div>` child of a `<ul>`
   * is invalid markup that browsers reparent — so the element is the caller's
   * to choose rather than always a div.
   */
  readonly as?: "div" | "li" | "section";
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  const Element = as;

  return <Element className={cx(CARD, className)}>{children}</Element>;
}

const HEADING: Record<2 | 3, "h2" | "h3"> = { 2: "h2", 3: "h3" };

export function CardHeader({
  title,
  action,
  headingLevel = 3,
}: {
  readonly title: ReactNode;
  readonly action?: ReactNode;
  /**
   * h3 by default: a card is nested inside a page that has exactly one h1 and
   * sections that use h2, so h3 is the outline that reads correctly without
   * anyone passing a prop. A card that is the direct child of the page takes 2.
   */
  readonly headingLevel?: 2 | 3;
}): ReactElement {
  const Heading = HEADING[headingLevel];

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <Heading className="text-base font-semibold text-ink">{title}</Heading>
      {action}
    </div>
  );
}
