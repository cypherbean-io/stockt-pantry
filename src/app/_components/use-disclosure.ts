"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * The behaviour the two header disclosures share (SPEC.md §3.3): the collapsed
 * navigation below `sm`, and the account menu at every width.
 *
 * Only the behaviour — no markup and no class names, so it stays a `.ts` file
 * and out of the `@source` glob in `globals.css`. What is genuinely common
 * between the two is the part that is invisible when it is missing: closing on
 * Escape, closing on a click outside, and putting focus back where it came
 * from. A second hand-written copy of that is a second chance to forget the
 * `removeEventListener`.
 */

export type Disclosure<TContainer extends HTMLElement> = {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
  /** Wraps the trigger and the panel. A click inside it is not "outside". */
  readonly containerRef: RefObject<TContainer | null>;
  /** Focus returns here on Escape, which is where it was before the panel opened. */
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
};

/**
 * Generic in the container element because the two call sites wrap different
 * ones — the navigation is a `<nav>` and the account menu is a `<div>` — and
 * `RefObject` is invariant, so a single `HTMLElement` ref would not be
 * assignable to either `ref` prop.
 */
export function useDisclosure<TContainer extends HTMLElement>(): Disclosure<TContainer> {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<TContainer | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  useEffect(() => {
    // Nothing is listening while the panel is shut, so a page that never opens
    // one — which is most page loads — adds no document-level handlers at all.
    if (!open) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Without this, focus is left on an element that has just been removed
      // and the browser drops it to <body> — so the next Tab starts again from
      // the top of the page rather than from the control that was just used.
      triggerRef.current?.focus();
    }

    function onPointerDown(event: PointerEvent): void {
      const container = containerRef.current;
      if (container === null) return;
      // `pointerdown` rather than `click`: a click that starts inside the panel
      // and ends outside it (a drag selecting the email address) is not a
      // dismissal, and `click` fires on the common ancestor for that gesture.
      if (event.target instanceof Node && !container.contains(event.target)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return { open, toggle, close, containerRef, triggerRef };
}
