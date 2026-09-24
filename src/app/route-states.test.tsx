import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PageHeader } from "./_components/ui/page-header";
import ErrorScreen from "./error";
import HouseholdLoading from "./household/loading";
import NotFound from "./not-found";
import PantryLoading from "./pantry/loading";
import RecipeLoading from "./recipes/[id]/loading";
import RecipesLoading from "./recipes/loading";

/**
 * The route-level states of SPEC.md §3.7: what the app shows while a page is
 * still loading, when a page throws, and when there is nothing at the address.
 *
 * The first of those is the one with teeth. CLAUDE.md is unambiguous that a
 * `DrizzleQueryError` formats as `Failed query: <sql>\nparams: <bound values>`
 * and that the string carries password hashes, invite token hashes and whole
 * recipes. `src/db/redact.ts` strips driver errors at the query layer;
 * `error.tsx` is the last place an unredacted error from anywhere else could
 * reach a screen. `src/packaging/packaging.test.ts` reads the file's source for
 * the same rule; this asserts the behaviour.
 */

/**
 * Every element in a tree, with function components resolved by calling them.
 *
 * Not `renderToStaticMarkup` plus a regex: `badge.test.tsx` already carries the
 * long version of why (`js/incomplete-multi-character-sanitization` — one regex
 * pass over HTML is the bug class this repo fixed once in
 * `src/lib/import/jsonld.ts`). React has the tree before anything serialises
 * it, so read that instead and there is no markup to parse.
 *
 * Calling a component is only equivalent to rendering it when the component is
 * hookless. Every one reachable from the trees walked here — the skeletons,
 * `PageHeader`, `Button` — is. Deliberately none of them reaches `next/link`,
 * which does use context: the one screen in this file that renders a link
 * (`not-found.tsx`) is asserted against rendered markup instead.
 */
function* elements(node: ReactNode): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elements(child as ReactNode);
    return;
  }

  if (!isValidElement(node)) return;

  yield node;

  if (typeof node.type === "function") {
    yield* elements((node.type as (props: unknown) => ReactNode)(node.props));
    return;
  }

  yield* elements((node.props as { readonly children?: ReactNode }).children);
}

type HostElement = ReactElement<Record<string, unknown>>;

/** The `<div>`s and `<span>`s a browser would actually receive. */
function hosts(node: ReactNode): readonly HostElement[] {
  return [...elements(node)].filter(
    (element): element is HostElement => typeof element.type === "string",
  );
}

function classesOf(element: HostElement): readonly string[] {
  const className = element.props["className"];

  return typeof className === "string" ? className.split(/\s+/).filter((part) => part !== "") : [];
}

/* ------------------------------------------------------------------ error */

/**
 * What a leaked `DrizzleQueryError` would look like, split across the two
 * places one carries content: the message and the stack. Both markers are
 * plain words and digits, so `renderToStaticMarkup` escapes none of them and a
 * substring check over the raw markup is exact.
 */
const IN_MESSAGE = "params scrypt 16384 8 1 aeff20c4 and the whole of chana masala";
const IN_STACK = "at src db queries auth ts findSessionByToken";

function thrown(digest?: string): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error(
    `Failed query select from session ${IN_MESSAGE}`,
  );

  error.stack = `Error: ${IN_STACK}`;
  if (digest !== undefined) error.digest = digest;

  return error;
}

function errorMarkup(digest?: string): string {
  return renderToStaticMarkup(<ErrorScreen error={thrown(digest)} retry={vi.fn()} />);
}

/**
 * Both shapes of error the boundary is handed. A server throw carries a digest
 * and a client throw does not, and the screen renders a different amount in
 * each case — so an assertion that only ever built one of them checks half the
 * component. Found by mutation: rendering `error.message` in place of the
 * digest passed the leak tests outright, because the only fixture they used
 * had no digest and so never rendered that branch at all.
 */
const DIGESTS = [undefined, "9f2a7c1d"];

describe("the error screen", () => {
  it.each(DIGESTS)("puts none of the thrown error's message on the page (digest %s)", (digest) => {
    // The whole point of SPEC.md §3.7. A message reaching here is a password
    // hash or a recipe on a screen, and in a screenshot of it.
    expect(errorMarkup(digest)).not.toContain(IN_MESSAGE);
  });

  it.each(DIGESTS)("puts none of the thrown error's stack on the page (digest %s)", (digest) => {
    expect(errorMarkup(digest)).not.toContain(IN_STACK);
  });

  it("shows the digest, which is the only handle on the matching server log", () => {
    expect(errorMarkup("9f2a7c1d")).toContain("9f2a7c1d");
  });

  it("shows no reference at all when the error carries no digest", () => {
    // Client-side throws have none. An empty "Reference" with nothing after it
    // reads as a second failure.
    expect(errorMarkup()).not.toContain("Reference");
  });

  it("gives the screen an h1, because the page that would have has crashed", () => {
    expect(errorMarkup()).toContain("<h1");
  });

  it("retries the segment rather than asking the reader to reload", () => {
    // Asserting the wire, not the label: a "Try again" that called nothing
    // looks identical in a screenshot and in every markup assertion above.
    const retry = vi.fn();
    const handlers = hosts(<ErrorScreen error={thrown()} retry={retry} />)
      .filter((element) => element.type === "button")
      .map((element) => element.props["onClick"])
      .filter((handler): handler is () => void => typeof handler === "function");

    expect(handlers).toHaveLength(1);
    handlers[0]?.();

    expect(retry).toHaveBeenCalledTimes(1);
  });
});

/* --------------------------------------------------------------- not found */

const notFoundMarkup = renderToStaticMarkup(<NotFound />);

/**
 * Words that would answer a question this page must not answer.
 *
 * `/recipes/[id]` routes an unknown id and another household's recipe to the
 * same `notFound()` on purpose — guessing an id must not be a way to learn
 * that it is real. A 404 that said "you do not have permission" would undo
 * that from the copy alone.
 */
const TELLS = ["permission", "household", "access", "allowed", "forbidden", "belongs", "yours"];

describe("the 404", () => {
  it("says there is nothing at the address", () => {
    expect(notFoundMarkup).toContain("nothing at this address");
  });

  it("gives the reader somewhere to go from a dead end", () => {
    expect(notFoundMarkup).toContain('href="/recipes"');
  });

  it("gives the screen an h1, because no page rendered one", () => {
    expect(notFoundMarkup).toContain("<h1");
  });

  it.each(TELLS)("does not distinguish a missing recipe from one that is not %s", (tell) => {
    expect(notFoundMarkup.toLowerCase()).not.toContain(tell);
  });
});

/* -------------------------------------------------------------- skeletons */

const SCREENS = [
  ["recipes", RecipesLoading],
  ["pantry", PantryLoading],
  ["recipes/[id]", RecipeLoading],
  ["household", HouseholdLoading],
] as const satisfies ReadonlyArray<readonly [string, () => ReactElement]>;

const appDirectory = fileURLToPath(new URL("./", import.meta.url));

/** Every route under `src/app` that has a `loading.tsx`, as a route path. */
function loadingRoutes(directory: string, route = ""): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const nested = route === "" ? entry.name : `${route}/${entry.name}`;

      return loadingRoutes(`${directory}${entry.name}/`, nested);
    }

    return entry.name === "loading.tsx" ? [route] : [];
  });
}

/** The spacing `PageHeader` reserves, read off the component rather than copied. */
const PAGE_HEADER_CLASSES = classesOf(
  hosts(<PageHeader title="What can I make?" />)[0] ?? ({ props: {} } as HostElement),
);

describe("the loading skeletons", () => {
  it("exist for exactly the routes SPEC.md §3.7 names", () => {
    // Both directions matter. A deleted file leaves a route with no loading
    // state; an added one is a decision, because a `loading.tsx` flushes the
    // response before the page runs and so gives up that route's status code.
    expect(new Set(loadingRoutes(appDirectory))).toEqual(new Set(SCREENS.map(([route]) => route)));
  });

  it.each(SCREENS)("%s announces itself once, by name", (_route, Loading) => {
    // One live region, and one thing in it a reader hears: "Loading the
    // pantry". Every bar below is hidden, so without this the announcement is
    // a region with no name at all.
    const live = hosts(<Loading />).filter((element) => element.props["role"] === "status");
    const labels = hosts(<Loading />)
      .filter((element) => classesOf(element).includes("sr-only"))
      .map((element) => element.props["children"]);

    expect(live).toHaveLength(1);
    expect(labels).toHaveLength(1);
    expect(typeof labels[0]).toBe("string");
    expect(labels[0]).toMatch(/\S/);
  });

  it.each(SCREENS)("%s keeps its placeholder bars out of the announcement", (_route, Loading) => {
    const bars = hosts(<Loading />).filter((element) =>
      classesOf(element).includes("motion-safe:animate-pulse"),
    );

    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.props["aria-hidden"]).toBe("true");
    }
  });

  it.each(SCREENS)("%s stops pulsing for a reader who asked for less motion", (_route, Loading) => {
    // SPEC.md §2.12 puts every animation behind `prefers-reduced-motion`. A
    // bare `animate-pulse` is the one spelling that ignores it.
    const classes = hosts(<Loading />).flatMap(classesOf);

    expect(classes).toContain("motion-safe:animate-pulse");
    expect(classes).not.toContain("animate-pulse");
  });

  it("is reading the real page header's spacing, not a copy of it", () => {
    // The drift guard for the assertion below: if `PageHeader` stops reserving
    // `mb-6`, this fails here rather than leaving four skeletons silently
    // measuring the wrong gap.
    expect(PAGE_HEADER_CLASSES).toContain("mb-6");
  });

  it.each(SCREENS)("%s reserves the page header's block, so the title does not jump", (_r, Loading) => {
    const classes = hosts(<Loading />).map(classesOf);

    expect(classes.some((tokens) => tokens.includes("mb-6"))).toBe(true);
  });
});
