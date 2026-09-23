import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { THEMES, type Theme } from "@/lib/theme/cookie";

import { nextTheme, ThemeToggle } from "./theme-toggle";

/**
 * The tri-state theme control of SPEC.md §3.4.
 *
 * What is pure here is the cycle, and it is worth stating as a test because a
 * three-state control written as a chain of ternaries is one typo away from a
 * two-state one — Light and Dark swapping forever with System unreachable, and
 * nothing to see in a screenshot.
 *
 * The flip itself (set `data-theme` on <html>, then persist through
 * `setThemeAction`) is a click handler and belongs to the Playwright suite of
 * SPEC.md §5, which asserts the thing that actually matters: that the served
 * HTML already carries the attribute on the next request.
 */

function triggerOf(markup: string): string {
  return /<button[^>]*>/.exec(markup)?.[0] ?? "";
}

describe("the theme cycle", () => {
  it("goes Light, then Dark, then back to following the system", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });

  it("reaches every theme, so none is stranded behind the others", () => {
    // A cycle that skipped one would leave "System" — the default, and the
    // only setting that follows the OS — unreachable once the user had ever
    // touched the control.
    expect(new Set(THEMES.map(nextTheme))).toEqual(new Set(THEMES));
  });

  it("returns to where it started in exactly as many clicks as there are themes", () => {
    let theme: Theme = "system";
    for (let click = 0; click < THEMES.length; click += 1) {
      theme = nextTheme(theme);
    }

    expect(theme).toBe("system");
  });
});

describe("the theme control", () => {
  it.each(THEMES)("says which theme is set when it is %s", (theme) => {
    // Icon-only, so the accessible name is the only place the current state is
    // stated. "Sun" is not a theme name.
    expect(triggerOf(renderToStaticMarkup(<ThemeToggle theme={theme} />))).toMatch(
      /aria-label="[^"]+"/,
    );
  });

  it("names the current theme and the one a click would pick", () => {
    // A toggle that only names its target reads as a lie about the present
    // state; one that only names the present state does not say what it does.
    const label = /aria-label="([^"]*)"/.exec(
      renderToStaticMarkup(<ThemeToggle theme="light" />),
    )?.[1];

    expect(label).toContain("Light");
    expect(label).toContain("Dark");
  });

  it.each(THEMES)("draws a different glyph for %s", (theme) => {
    // Three states and one glyph is a control whose position you have to
    // remember. The paths come from `icons.tsx`; what is asserted is that they
    // differ, not what they look like.
    const others = THEMES.filter((other) => other !== theme).map((other) =>
      renderToStaticMarkup(<ThemeToggle theme={other} />),
    );

    expect(others).not.toContain(renderToStaticMarkup(<ThemeToggle theme={theme} />));
  });

  it("does not submit the page it sits on", () => {
    expect(triggerOf(renderToStaticMarkup(<ThemeToggle theme="system" />))).toContain(
      'type="button"',
    );
  });

  it("is a thumb-sized target like every other control", () => {
    expect(triggerOf(renderToStaticMarkup(<ThemeToggle theme="system" />))).toContain("min-h-tap");
  });
});
