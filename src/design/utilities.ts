import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";

/**
 * Tailwind, run against the real `globals.css` from inside Vitest — the test
 * support behind `utilities.test.tsx` and `src/app/screens.test.tsx`.
 *
 * Almost all of this app's styling is class names in string literals, and
 * nothing else in the suite can tell `bg-surface-raised` from
 * `bg-surface-raise`: TypeScript and ESLint see two strings, and Tailwind's
 * answer to a class it does not recognise is to emit no rule at all. So the
 * tests harvest every class a rendered tree actually ships and put each one
 * through the real compiler. A token dropped from `@theme inline` fails that
 * too — `--surface-raised` declared but not mapped generates no
 * `bg-surface-raised`, which `tokens.test.ts` cannot see from the stylesheet
 * alone.
 *
 * This uses `tailwindcss` directly rather than the PostCSS plugin. Both are
 * already devDependencies; the plugin would add a `postcss` import for a
 * wrapper this needs nothing from. Not imported by anything the app ships.
 */

/** Every class in some rendered markup, deduplicated, in a stable order. */
export function classCandidates(markup: string): readonly string[] {
  return [
    ...new Set(
      [...markup.matchAll(/class="([^"]*)"/g)]
        .flatMap((match) => (match[1] ?? "").split(/\s+/))
        .filter((candidate) => candidate !== ""),
    ),
  ].sort();
}

const require = createRequire(import.meta.url);
const stylesheet = fileURLToPath(new URL("../app/globals.css", import.meta.url));

const compiler = compile(readFileSync(stylesheet, "utf8"), {
  base: dirname(stylesheet),
  loadStylesheet: async (id: string, base: string) => {
    // `@import "tailwindcss"` is a package, the imports inside it are relative.
    const file = id.startsWith(".")
      ? resolve(base, id)
      : require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id);

    return { path: file, base: dirname(file), content: readFileSync(file, "utf8") };
  },
});

/** The stylesheet `globals.css` produces for exactly these candidates. */
export async function compileCandidates(candidates: readonly string[]): Promise<string> {
  return (await compiler).build([...candidates]);
}

/**
 * The selector Tailwind writes for a candidate: `sm:flex` becomes `.sm\:flex`.
 *
 * Matched with a trailing boundary, because a compiled stylesheet is one
 * string holding every rule and a plain substring test passes for any
 * candidate that is a *prefix* of a real one. `bg-surface-raise` compiles to
 * nothing and would still be found inside `.bg-surface-raised` — which is
 * precisely the typo this exists to catch, so the boundary is the assertion,
 * not a detail.
 *
 * Two layers of escaping: Tailwind escapes the selector, then the regex has to
 * escape Tailwind's backslashes.
 */
export function selectorPattern(candidate: string): RegExp {
  const selector = `.${candidate.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)}`;

  return new RegExp(`${selector.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}(?![\\w-])`);
}
