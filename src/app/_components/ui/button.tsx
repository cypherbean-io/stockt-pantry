import Link from "next/link";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";

import { cx } from "./class-names";

/**
 * The button pair (SPEC.md §3.6).
 *
 * `Button` does something; `LinkButton` goes somewhere. They look identical on
 * purpose and are different elements on purpose — "Add a recipe" is navigation
 * wearing a button's clothes, and rendering it as a `<button>` would cost
 * middle-click, the status bar and the back button for nothing.
 *
 * Neither is a Client Component. They hold no state, so they render inside the
 * server pages and the `"use client"` forms alike; a `"use client"` directive
 * here would drag every page that renders a button into the client bundle.
 */

export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
export const BUTTON_SIZES = ["sm", "md"] as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = (typeof BUTTON_SIZES)[number];

/**
 * `min-h-tap`/`min-w-tap` are on the base, not on `md` alone: SPEC.md §2.9
 * wants every interactive target at 44x44 CSS px and §5's mobile spec measures
 * it. A small button is smaller in text and padding, never in how easy it is
 * to hit with a thumb.
 *
 * The focus style is an outline rather than a ring because an outline follows
 * the element's own shape and survives Windows High Contrast, where a
 * box-shadow ring is simply not painted.
 */
const BASE =
  "inline-flex min-h-tap min-w-tap items-center justify-center gap-2 rounded-control border font-medium " +
  "motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-60";

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 text-sm",
  md: "px-4 text-base",
};

/**
 * Every variant sets a border, even the ones whose border is transparent, so
 * that swapping between them never changes the element's size.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-accent text-accent-ink hover:opacity-90",
  secondary: "border-border-strong bg-surface-raised text-ink hover:bg-surface",
  ghost: "border-transparent bg-transparent text-ink hover:bg-surface-raised",
  danger: "border-transparent bg-status-gap text-status-gap-ink hover:opacity-90",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
} = {}): string {
  return cx(BASE, SIZE[size], VARIANT[variant], className);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "dangerouslySetInnerHTML"> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}): ReactElement {
  // `dangerouslySetInnerHTML` is omitted rather than merely unused: `{...props}`
  // would forward it, and this is about to be the component every screen
  // renders. `src/` has no raw-HTML sink anywhere today; making one untypeable
  // here keeps it that way without anyone having to notice it in a diff.
  // `type` after the spread, and defaulted: HTML makes a typeless <button> a
  // submit button, and this app puts buttons inside forms on nearly every
  // screen. A Remove control or a disclosure toggle that quietly submitted the
  // form around it is a bug nobody would look for in a styling component.
  return <button {...props} type={type} className={buttonClass({ variant, size, className })} />;
}

export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
}: {
  /**
   * An internal route, and typed so that an absolute URL does not compile.
   *
   * Not because `javascript:` is reachable — React 19 replaces such an href
   * with a blocked-URL throw, and `next/link` declines to intercept a
   * non-local one — but because `recipe.sourceUrl` is user-supplied at import
   * and stored verbatim, and "Open the original" is an obvious thing to want
   * next. That link needs `rel="noopener noreferrer"` and a scheme check,
   * which is a different component; this type is what forces someone to write
   * it rather than reaching for this one.
   *
   * It does not stop a protocol-relative `//host/path`, which TypeScript
   * cannot express. Nothing constructs an href from user input today.
   */
  readonly href: `/${string}`;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })}>
      {children}
    </Link>
  );
}
