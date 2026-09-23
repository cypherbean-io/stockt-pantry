import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isCurrent, NAV_ITEMS, NAV_PANEL_ID, NavBar } from "./nav";

/**
 * The primary navigation of SPEC.md §3.3.
 *
 * Today every page hand-writes its own `·`-separated line of links and they
 * disagree — `/pantry` offers two, `/recipes` four, `/recipes/[id]` one — and
 * nothing indicates where you are. Both halves of that are asserted here: one
 * list of destinations, and exactly one of them marked as the current page.
 *
 * `NavBar` takes the pathname as a prop and `Nav` is the three-line wrapper
 * that reads it from `usePathname()`. That split is what makes the active
 * indicator testable without a router, which matters because "which link is
 * highlighted" is the kind of off-by-one that only shows up on the one route
 * nobody clicked during review.
 */

function currentLinks(markup: string): number {
  return markup.match(/aria-current="page"/g)?.length ?? 0;
}

describe("isCurrent", () => {
  it("marks the section you are looking at", () => {
    expect(isCurrent("/pantry", "/pantry")).toBe(true);
  });

  it("keeps the section lit on a page below it", () => {
    // /recipes/new and /recipes/[id] are inside Recipes. A nav that went blank
    // as soon as you opened a recipe would answer "where am I" with nothing on
    // most of the screens in the app.
    expect(isCurrent("/recipes/new", "/recipes")).toBe(true);
    expect(isCurrent("/recipes/8f14e45f-ceea-467a-9c2b-4e4b4b4b4b4b", "/recipes")).toBe(true);
  });

  it("does not light a section whose href is merely a prefix of the path", () => {
    // The separator is what makes this a path comparison rather than a string
    // one. Without it `/recipes-archive` would light Recipes.
    expect(isCurrent("/recipes-archive", "/recipes")).toBe(false);
    expect(isCurrent("/pantryitems", "/pantry")).toBe(false);
  });

  it("lights nothing for a section you are not in", () => {
    expect(isCurrent("/pantry", "/recipes")).toBe(false);
  });

  it("lights nothing when the pathname is not known yet", () => {
    // `usePathname()` is documented to return null before the router has
    // initialised. A nav that threw there would take the whole shell — and so
    // every page — down over an indicator.
    expect(isCurrent(null, "/recipes")).toBe(false);
  });
});

describe("the navigation", () => {
  it("offers the three destinations the per-page link lines used to", () => {
    // /recipes, /pantry and /household are the whole signed-in surface. The
    // contextual links those lines also carried ("Import from a URL") are not
    // navigation and belong to the page header instead.
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(["/recipes", "/pantry", "/household"]);
  });

  it("links to every destination it names", () => {
    const markup = renderToStaticMarkup(<NavBar pathname="/recipes" />);

    for (const { href, label } of NAV_ITEMS) {
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain(label);
    }
  });

  it("marks exactly one link as the page you are on", () => {
    // More than one is the bug this indicator is most likely to have, because
    // "starts with" matches two hrefs as soon as one is a prefix of another.
    expect(currentLinks(renderToStaticMarkup(<NavBar pathname="/recipes/new" />))).toBe(1);
    expect(currentLinks(renderToStaticMarkup(<NavBar pathname="/household" />))).toBe(1);
  });

  it("marks none when you are somewhere the nav does not go", () => {
    expect(currentLinks(renderToStaticMarkup(<NavBar pathname="/login" />))).toBe(0);
  });

  it("says where you are to a screen reader, not only in colour", () => {
    // `aria-current` is the channel that does not depend on seeing the
    // background tint at all.
    expect(renderToStaticMarkup(<NavBar pathname="/pantry" />)).toMatch(
      /href="\/pantry"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/pantry"/,
    );
  });

  it("keeps the links reachable at sm and above without opening anything", () => {
    // The disclosure is a phone affordance. Rendering the list behind `hidden`
    // with no `sm:` escape would hide the whole nav on a desktop until someone
    // clicked a button that is not there.
    const markup = renderToStaticMarkup(<NavBar pathname="/recipes" />);
    const panel = new RegExp(`id="${NAV_PANEL_ID}"[^>]*class="([^"]*)"`).exec(markup)?.[1] ?? "";

    expect(panel).toContain("hidden");
    expect(panel).toContain("sm:flex");
  });

  it("collapses behind a button that is only there when the links are not", () => {
    // SPEC.md §3.3: below `sm` the nav collapses behind a disclosure. The
    // button carries `sm:hidden` so that at desktop widths there is no
    // `aria-expanded="false"` contradicting a list that is plainly visible.
    const markup = renderToStaticMarkup(<NavBar pathname="/recipes" />);
    const trigger = /<button[^>]*>/.exec(markup)?.[0] ?? "";

    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain(`aria-controls="${NAV_PANEL_ID}"`);
    expect(trigger).toContain("sm:hidden");
  });

  it("does not submit the form it might one day sit inside", () => {
    // HTML defaults a typeless <button> to submit. The shell wraps every page,
    // including the ones that are a single form.
    expect(renderToStaticMarkup(<NavBar pathname="/recipes" />)).toContain('type="button"');
  });

  it("gives every link a thumb-sized target", () => {
    // SPEC.md §2.9, and the nav is the control a phone user hits most.
    const markup = renderToStaticMarkup(<NavBar pathname="/recipes" />);
    const links = [...markup.matchAll(/<a[^>]*class="([^"]*)"/g)].map((match) => match[1] ?? "");

    expect(links).toHaveLength(NAV_ITEMS.length);
    for (const link of links) {
      expect(link).toContain("min-h-tap");
    }
  });

  it("names itself, so a landmark list distinguishes it", () => {
    expect(renderToStaticMarkup(<NavBar pathname="/recipes" />)).toMatch(
      /<nav[^>]*aria-label="Primary"/,
    );
  });
});
