/**
 * `clsx` in four lines.
 *
 * Every component in this directory is a fixed base class plus a variant plus
 * whatever the caller adds, and two of those three are routinely absent. The
 * template-literal form leaves stray spaces that make class attributes
 * annoying to assert on; `clsx` and `tailwind-merge` are the packages SPEC.md
 * §3.10 turned down along with `shadcn/ui`.
 *
 * Deliberately not a merge: this does not resolve `p-2` against `p-4`. Later
 * wins in the emitted stylesheet by source order, not by call order, so a
 * "merge" that pretended otherwise would be wrong in a way that only shows up
 * at certain breakpoints. Callers override by variant, not by stacking.
 */
export function cx(...parts: ReadonlyArray<string | false | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}
