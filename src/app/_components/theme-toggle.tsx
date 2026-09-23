"use client";

import { useState, useTransition, type ComponentType, type ReactElement } from "react";

import { setThemeAction } from "@/app/actions/theme";
import type { Theme } from "@/lib/theme/cookie";

import { ContrastIcon, MoonIcon, SunIcon } from "./icons";
import { Button } from "./ui/button";

/**
 * The tri-state theme control (SPEC.md §3.4): Light → Dark → System.
 *
 * Three states rather than two because "System" is the default and is the only
 * setting that keeps following the OS; a two-state toggle would strand it the
 * moment the user touched the control once.
 *
 * The click does two things, in this order. First it sets `data-theme` on
 * `<html>` directly, so the flip is immediate rather than waiting on a round
 * trip. Then it persists through `setThemeAction`, and the *next* server
 * render reads the cookie that action just wrote — so the attribute React
 * renders and the attribute this set always agree, and there is no flash on
 * reload to engineer around. That is the whole reason the theme is a cookie
 * and not `localStorage` plus a blocking inline `<script>` (SPEC.md §3.10).
 */

const CYCLE: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/** Exported for its own sake: a three-state cycle is easy to write as a two-state one. */
export function nextTheme(theme: Theme): Theme {
  return CYCLE[theme];
}

const LABEL: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const GLYPH: Record<Theme, ComponentType<{ readonly className?: string }>> = {
  light: SunIcon,
  dark: MoonIcon,
  system: ContrastIcon,
};

export function ThemeToggle({ theme }: { readonly theme: Theme }): ReactElement {
  // Seeded from the server-rendered value and then owned here, so the button
  // reflects the click before the action that persists it has returned.
  const [current, setCurrent] = useState(theme);
  const [, startTransition] = useTransition();

  const Glyph = GLYPH[current];
  const next = nextTheme(current);
  // Both halves: a control that only names its target reads as a lie about the
  // present state, and one that only names the present state does not say what
  // pressing it does.
  const label = `Theme: ${LABEL[current]}. Switch to ${LABEL[next]}.`;

  function cycle(): void {
    setCurrent(next);

    // "System" is the absence of the attribute, not a value of it — that is
    // what lets the `prefers-color-scheme` block in globals.css take over
    // again. Setting `data-theme="system"` would match none of the three
    // selectors and pin the page to light on a dark OS.
    if (next === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = next;
    }

    startTransition(async () => {
      await setThemeAction(next);
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycle}
      aria-label={label}
      // The same text as a tooltip, because the control is a glyph and a
      // sighted mouse user has nothing else to read it by.
      title={label}
    >
      <Glyph />
    </Button>
  );
}
