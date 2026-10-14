import { describe, expect, it } from "vitest";

import { PANTRY, RECIPE } from "@/lib/fixtures";

import { matchRecipe } from "./match";
import {
  BUCKET_LABEL,
  BUCKET_ORDER,
  countByStatus,
  groupByBucket,
  recipeBucket,
  summarise,
  type BucketGroup,
  type RecipeBucket,
} from "./summary";
import type { LineStatus, MatchResult, MatchedLine } from "./types";
import { UNITS } from "./units";

/**
 * SPEC.md §3.5: the four buckets `/recipes` groups recipes under, and the one
 * line of text each row carries.
 *
 * The bucket is derived from the lines alone, never from `result.makeable`.
 * That is what lets the invariant at the bottom of this file mean something:
 * "ready if and only if makeable" compares two independent computations over
 * the real engine's output, rather than one function restating the other.
 */

/** A hand-built line whose numbers agree with its status. */
const LINE: Record<LineStatus, Pick<MatchedLine, "available" | "shortfall">> = {
  have: { available: 100, shortfall: 0 },
  short: { available: 40, shortfall: 60 },
  missing: { available: 0, shortfall: 100 },
  unresolved: { available: null, shortfall: 0 },
};

function resultOf(...statuses: readonly LineStatus[]): MatchResult {
  const lines = statuses.map(
    (status, index): MatchedLine => ({
      ingredient: { id: `line-${index}`, name: `Line ${index}` },
      required: { value: 100, unit: UNITS.g },
      status,
      ...LINE[status],
    }),
  );

  // `makeable` the way `matchRecipe` computes it, so a hand-built result is
  // one the engine could actually have produced.
  return {
    recipeName: "Hand-built",
    servings: 4,
    makeable: lines.every((line) => line.status === "have"),
    lines,
  };
}

/**
 * Every sub-recipe of the engine's fixture — all 2^6 subsets of its lines, the
 * empty one included — at both serving counts `match.test.ts` evaluates it at.
 * The fixture holds every line status at once, and doubling it turns two
 * "have" lines short, so between them these reach every bucket through
 * `matchRecipe` rather than through a hand-built result.
 */
function fixtureResults(): MatchResult[] {
  const lines = RECIPE.ingredients;

  return [RECIPE.baseServings, RECIPE.baseServings * 2].flatMap((servings) =>
    Array.from({ length: 2 ** lines.length }, (_, mask) =>
      matchRecipe(
        { ...RECIPE, ingredients: lines.filter((_, i) => (mask & (1 << i)) !== 0) },
        PANTRY,
        servings,
      ),
    ),
  );
}

function describeResult(result: MatchResult): string {
  const lines = result.lines.map((line) => `${line.ingredient.id}:${line.status}`).join(", ");
  return `[${lines}] at ${result.servings} servings`;
}

describe("countByStatus", () => {
  it("counts every status, including the ones no line has", () => {
    expect(countByStatus(resultOf("short", "have", "short", "unresolved"))).toEqual({
      have: 1,
      short: 2,
      missing: 0,
      unresolved: 1,
    });
  });

  it("counts nothing in a recipe with no lines", () => {
    expect(countByStatus(resultOf())).toEqual({ have: 0, short: 0, missing: 0, unresolved: 0 });
  });

  it("counts the engine's fixture line by line", () => {
    // flour, sugar, egg have; butter missing; choc-chips short; vanilla
    // unresolved — the same classification `match.test.ts` asserts.
    expect(countByStatus(matchRecipe(RECIPE, PANTRY))).toEqual({
      have: 3,
      short: 1,
      missing: 1,
      unresolved: 1,
    });
  });
});

describe("recipeBucket", () => {
  // The full truth table of (toBuy > 0, unresolved > 0), where toBuy is
  // missing + short. The "to buy" cells are each reached through missing
  // alone and short alone, so forgetting either status fails a row instead of
  // hiding behind the other.
  it.each<{ statuses: LineStatus[]; bucket: RecipeBucket }>([
    { statuses: [], bucket: "ready" },
    { statuses: ["have", "have"], bucket: "ready" },
    { statuses: ["missing"], bucket: "shopping" },
    { statuses: ["short", "have"], bucket: "shopping" },
    { statuses: ["missing", "short"], bucket: "shopping" },
    { statuses: ["unresolved"], bucket: "unverifiable" },
    { statuses: ["have", "unresolved", "unresolved"], bucket: "unverifiable" },
    { statuses: ["unresolved", "missing"], bucket: "partly-unverifiable" },
    { statuses: ["short", "short", "unresolved"], bucket: "partly-unverifiable" },
    { statuses: ["have", "missing", "short", "unresolved"], bucket: "partly-unverifiable" },
  ])("puts $statuses in $bucket", ({ statuses, bucket }) => {
    expect(recipeBucket(resultOf(...statuses))).toBe(bucket);
  });

  it("reads the lines, not the makeable flag", () => {
    expect(recipeBucket({ ...resultOf("missing"), makeable: true })).toBe("shopping");
    expect(recipeBucket({ ...resultOf("have"), makeable: false })).toBe("ready");
  });

  it("calls a recipe with no ingredient lines ready, as the engine calls it makeable", () => {
    const empty = matchRecipe({ ...RECIPE, ingredients: [] }, PANTRY);

    expect(empty.makeable).toBe(true);
    expect(recipeBucket(empty)).toBe("ready");
  });
});

describe("a line status outside the four", () => {
  // Only reachable from outside the type system today — but it is also what a
  // fifth `LineStatus` looks like to this module until someone decides whether
  // it means "to buy" or "can't verify". Either way it must fail closed: an
  // uncookable recipe is never filed under Ready to cook.
  const stray = resultOf("have", "expired" as string as LineStatus);

  it("is refused by recipeBucket rather than read as ready", () => {
    expect(() => recipeBucket(stray)).toThrow(/status/);
  });

  it("is refused by summarise rather than read as ready", () => {
    expect(() => summarise(stray)).toThrow(/status/);
  });
});

describe("summarise", () => {
  it.each<{ statuses: LineStatus[]; text: string }>([
    { statuses: ["have", "have"], text: "Ready to cook" },
    { statuses: [], text: "Ready to cook" },
    { statuses: ["missing", "short", "have"], text: "2 to buy" },
    { statuses: ["unresolved"], text: "1 can't verify" },
    // Partly unverifiable names both counts, so it is not a dead end: you can
    // see there is shopping to do *and* that the list will be incomplete.
    { statuses: ["short", "short", "unresolved"], text: "2 to buy · 1 can't verify" },
  ])("summarises $statuses as '$text'", ({ statuses, text }) => {
    expect(summarise(resultOf(...statuses))).toBe(text);
  });

  it("summarises the engine's fixture with both counts", () => {
    expect(summarise(matchRecipe(RECIPE, PANTRY))).toBe("2 to buy · 1 can't verify");
  });
});

describe("the bucket vocabulary", () => {
  it("lists the buckets most actionable first", () => {
    expect([...BUCKET_ORDER]).toEqual(["ready", "shopping", "partly-unverifiable", "unverifiable"]);
  });

  it("lists every bucket exactly once", () => {
    // `BUCKET_LABEL` is a total Record (the next test keeps it one), so its
    // keys are the whole set of buckets.
    expect(new Set(BUCKET_ORDER).size).toBe(BUCKET_ORDER.length);
    expect([...BUCKET_ORDER].sort()).toEqual(Object.keys(BUCKET_LABEL).sort());
  });

  it("will not compile with a bucket left unlabelled", () => {
    // Enforced by `npm run typecheck`, not by vitest: an unused
    // `@ts-expect-error` is itself a compile error. If `BUCKET_LABEL` were
    // widened to `Partial<...>` or `Record<string, string>`, a fifth bucket
    // would render under an `undefined` heading instead of failing the build.
    // @ts-expect-error A label map must name every bucket.
    const partial: typeof BUCKET_LABEL = {
      ready: "Ready to cook",
      shopping: "Needs shopping",
      "partly-unverifiable": "Partly unverifiable",
    };

    expect(partial).toBeDefined();
  });

  it("labels each bucket with the heading /recipes groups under", () => {
    expect(BUCKET_LABEL).toEqual({
      ready: "Ready to cook",
      shopping: "Needs shopping",
      "partly-unverifiable": "Partly unverifiable",
      unverifiable: "Can't verify",
    });
  });
});

describe("against every sub-recipe of the engine's fixture", () => {
  const results = fixtureResults();

  it("buckets as ready exactly the recipes the engine calls makeable", () => {
    for (const result of results) {
      expect(recipeBucket(result) === "ready", describeResult(result)).toBe(result.makeable);
    }
  });

  it("summarises as ready exactly the recipes the engine calls makeable", () => {
    for (const result of results) {
      expect(summarise(result) === "Ready to cook", describeResult(result)).toBe(result.makeable);
    }
  });

  it("reaches all four buckets, so neither side of the invariant is vacuous", () => {
    expect(new Set(results.map((result) => recipeBucket(result)))).toEqual(new Set(BUCKET_ORDER));
  });
});

describe("groupByBucket", () => {
  /** A list row as `/recipes` holds one: something to name it by, and its match. */
  function entry(name: string, ...statuses: readonly LineStatus[]) {
    return { name, result: resultOf(...statuses) };
  }

  function names(groups: readonly BucketGroup<{ readonly name: string }>[]) {
    return groups.map(({ bucket, entries }) => [bucket, entries.map(({ name }) => name)]);
  }

  it("groups in display order, whatever order the entries arrive in", () => {
    const groups = groupByBucket([
      entry("Focaccia", "short", "unresolved"),
      entry("Pancakes", "unresolved"),
      entry("Risotto", "missing"),
      entry("Toast", "have"),
    ]);

    expect(names(groups)).toEqual([
      ["ready", ["Toast"]],
      ["shopping", ["Risotto"]],
      ["partly-unverifiable", ["Focaccia"]],
      ["unverifiable", ["Pancakes"]],
    ]);
  });

  it("leaves out a bucket nothing falls into, so it draws no heading", () => {
    // SPEC.md §3.5: "Empty buckets render no heading."
    const groups = groupByBucket([entry("Toast", "have"), entry("Pancakes", "unresolved")]);

    expect(groups.map(({ bucket }) => bucket)).toEqual(["ready", "unverifiable"]);
  });

  it("answers no groups at all for no recipes", () => {
    expect(groupByBucket([])).toEqual([]);
  });

  it("keeps the order entries arrived in within a bucket", () => {
    // The page hands them over in name order; grouping must not shuffle that.
    const groups = groupByBucket([
      entry("Apple pie", "missing"),
      entry("Toast", "have"),
      entry("Bread", "short"),
      entry("Crumble", "missing", "short"),
    ]);

    expect(names(groups)).toEqual([
      ["ready", ["Toast"]],
      ["shopping", ["Apple pie", "Bread", "Crumble"]],
    ]);
  });

  it("hands back the entries themselves, not copies", () => {
    const toast = entry("Toast", "have");

    expect(groupByBucket([toast])[0]?.entries[0]).toBe(toast);
  });

  it("files every engine-produced result exactly once, under its own bucket", () => {
    const entries = fixtureResults().map((result, index) => ({ name: `r${index}`, result }));
    const groups = groupByBucket(entries);

    expect(groups.flatMap((group) => group.entries)).toHaveLength(entries.length);
    expect(new Set(groups.flatMap((group) => group.entries)).size).toBe(entries.length);
    for (const { bucket, entries: members } of groups) {
      expect(members.length, bucket).toBeGreaterThan(0);
      for (const member of members) {
        expect(recipeBucket(member.result), describeResult(member.result)).toBe(bucket);
      }
    }
  });

  it("refuses a line status it cannot classify rather than dropping the recipe", () => {
    expect(() => groupByBucket([entry("Stray", "expired" as string as LineStatus)])).toThrow(
      /status/,
    );
  });
});
