import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountPanel } from "@/app/_components/account-menu";
import { NAV_PANEL_ID, NavBar } from "@/app/_components/nav";
import { FieldError, FormMessage } from "@/app/_components/ui/field";

import { classCandidates, compileCandidates, selectorPattern } from "./utilities";

/**
 * The micro-interactions of SPEC.md §2 item 12: ~120–180 ms transitions,
 * disclosures that expand and collapse, inline form messages that fade in —
 * "all behind `prefers-reduced-motion`".
 *
 * The last clause is the one worth a test. Every one of these is a class name
 * in a string, and the difference between motion that respects the setting and
 * motion that ignores it is a `motion-safe:` prefix nobody sees in review. So
 * the rendered classes go through the real compiler (`./utilities.ts`), and the
 * assertion is about where the resulting rule lands, not about the spelling.
 */

const REDUCED_MOTION_GUARD = "@media (prefers-reduced-motion: no-preference)";

/**
 * The compiled CSS split into what sits inside a reduced-motion guard and what
 * does not. Brace-matched rather than regex-matched, because Tailwind nests the
 * guard inside breakpoint queries (`max-sm:motion-safe:…`) and the blocks hold
 * rules of their own.
 */
function splitByGuard(css: string): { readonly guarded: string; readonly unguarded: string } {
  let guarded = "";
  let unguarded = "";
  let cursor = 0;

  for (let start = css.indexOf(REDUCED_MOTION_GUARD); start !== -1; ) {
    const open = css.indexOf("{", start);
    let depth = 1;
    let close = open + 1;
    for (; depth > 0; close++) {
      if (css[close] === "{") depth++;
      if (css[close] === "}") depth--;
    }

    unguarded += css.slice(cursor, start);
    guarded += css.slice(open + 1, close - 1);
    cursor = close;
    start = css.indexOf(REDUCED_MOTION_GUARD, cursor);
  }

  return { guarded, unguarded: unguarded + css.slice(cursor) };
}

/** Whether a class only ever produces CSS for a reader who has not asked for less motion. */
async function onlyRunsWithMotionAllowed(candidate: string): Promise<boolean> {
  const { guarded, unguarded } = splitByGuard(await compileCandidates([candidate]));
  const selector = selectorPattern(candidate);

  return selector.test(guarded) && !selector.test(unguarded);
}

function classesOf(markup: string): readonly string[] {
  return classCandidates(markup);
}

describe("an inline form message", () => {
  it("fades in when a form-level message appears", () => {
    expect(classesOf(renderToStaticMarkup(<FormMessage message="Email or password is wrong" />))).toContain(
      "motion-safe:animate-fade-in",
    );
  });

  it("fades in when a field error appears", () => {
    expect(classesOf(renderToStaticMarkup(<FieldError id="email" error="Enter an address" />))).toContain(
      "motion-safe:animate-fade-in",
    );
  });

  it("does not animate for a reader who asked for less motion", async () => {
    expect(await onlyRunsWithMotionAllowed("motion-safe:animate-fade-in")).toBe(true);
  });

  it("fades over a duration inside the 120–180 ms SPEC.md names", async () => {
    const css = await compileCandidates(["motion-safe:animate-fade-in"]);
    const duration = /animation:\s*fade-in\s+(\d+)ms/.exec(css)?.[1];

    expect(duration, "no `animation: fade-in <n>ms` in the compiled rule").toBeDefined();
    expect(Number(duration)).toBeGreaterThanOrEqual(120);
    expect(Number(duration)).toBeLessThanOrEqual(180);
  });

  it("ships the keyframes the animation names", async () => {
    // An `animation` naming keyframes that were never emitted is silently no
    // animation at all.
    expect(await compileCandidates(["motion-safe:animate-fade-in"])).toMatch(/@keyframes fade-in\s*\{/);
  });
});

describe("the navigation disclosure", () => {
  // Static markup renders it shut, which is the state a collapse ends in.
  const panelClasses = (() => {
    const markup = renderToStaticMarkup(<NavBar pathname="/recipes" />);
    const panel = new RegExp(`<ul id="${NAV_PANEL_ID}" class="([^"]*)"`).exec(markup)?.[1];
    if (panel === undefined) throw new Error("the navigation panel was not rendered");
    return panel.split(/\s+/);
  })();

  it("transitions its opacity, position and display as it opens and closes", async () => {
    // `display` is the one that makes collapse visible: without
    // `allow-discrete` the panel is `display: none` on the first frame and
    // the opacity transition has nothing left to draw.
    const css = await compileCandidates(panelClasses);
    const properties = /transition-property:\s*([^;]+);/.exec(css)?.[1]?.split(/\s*,\s*/) ?? [];

    expect(properties).toEqual(expect.arrayContaining(["opacity", "translate", "display"]));
    expect(css).toMatch(/transition-behavior:\s*allow-discrete/);
  });

  it("starts an expand from transparent, so opening is animated too", () => {
    // `@starting-style` is what gives a transition out of `display: none` a
    // first frame to start from.
    expect(panelClasses).toContain("max-sm:starting:opacity-0");
  });

  it("collapses towards transparent", () => {
    expect(panelClasses).toContain("hidden");
    expect(panelClasses).toContain("opacity-0");
  });

  it("keeps the desktop row opaque, where there is nothing to collapse", () => {
    // At `sm` the panel *is* the nav bar and the disclosure state is moot. The
    // collapsed opacity must not reach it, or the closed state is invisible.
    expect(panelClasses).toContain("sm:opacity-100");
  });

  it("does not move for a reader who asked for less motion", async () => {
    for (const candidate of panelClasses.filter((name) => name.includes("transition"))) {
      expect(await onlyRunsWithMotionAllowed(candidate), candidate).toBe(true);
    }
  });
});

describe("the account disclosure", () => {
  it("fades in when it opens", () => {
    // It collapses instantly. The panel is rendered only while it is open, so
    // that the signed-in email is not in the markup of every page, and an
    // exit animation needs an element that is still there to animate.
    expect(classesOf(renderToStaticMarkup(<AccountPanel email="someone@example.test" />))).toContain(
      "motion-safe:animate-fade-in",
    );
  });
});

/* ------------------------------------------------------------- the guard */

/**
 * Every `animate-*` and `transition*` class written anywhere in the app,
 * minus the ones behind `motion-safe:` / `motion-reduce:`. Read from source
 * rather than from rendered markup so that a class only some state renders —
 * an open disclosure, an error — is covered without having to reach it.
 * Comments are stripped, as in `tokens.test.ts`: several of them talk about
 * these classes by name.
 */
const MOTION_UTILITY = /^(?:animate-[\w-]+|transition(?:-[\w[\],-]+)?)$/;

function unguardedMotion(source: string): readonly string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  return code
    .split(/[\s"'`{}()]+/)
    .filter((token) => {
      const parts = token.split(":");
      const utility = parts.at(-1) ?? "";
      if (!MOTION_UTILITY.test(utility)) return false;
      const variants = parts.slice(0, -1);
      return !variants.includes("motion-safe") && !variants.includes("motion-reduce");
    });
}

const APP_DIRECTORY = fileURLToPath(new URL("../app/", import.meta.url));

const COMPONENTS = readdirSync(APP_DIRECTORY, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".tsx") && !path.endsWith(".test.tsx"))
  .map((path) => ({ path, source: readFileSync(`${APP_DIRECTORY}${path}`, "utf8") }));

describe("every animation in the app", () => {
  it("is read from the real source tree", () => {
    expect(COMPONENTS.length).toBeGreaterThan(30);
  });

  it("recognises unguarded motion in every spelling it can take", () => {
    // The self-test: a guard that matched nothing would pass every file.
    expect(
      unguardedMotion(
        'className="animate-pulse transition sm:transition-colors transition-[opacity,display] ' +
          'motion-safe:transition-colors motion-reduce:transition-none max-sm:motion-safe:animate-fade-in"',
      ),
    ).toEqual(["animate-pulse", "transition", "sm:transition-colors", "transition-[opacity,display]"]);
  });

  it.each(COMPONENTS.map(({ path }) => path))(
    "%s puts every animation and transition behind prefers-reduced-motion",
    (path) => {
      const source = COMPONENTS.find((component) => component.path === path)?.source ?? "";

      expect(unguardedMotion(source)).toEqual([]);
    },
  );
});
