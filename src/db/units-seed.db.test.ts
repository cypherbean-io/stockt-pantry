import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { unit } from "./schema";
import { testDb } from "./testing/harness";
import { UNITS } from "@/lib/matching/units";

/**
 * The `unit` rows are seeded by a checked-in SQL migration, but `UNITS` in
 * `src/lib/matching/units.ts` is the source of truth — the matching engine is
 * pure logic and never reads the table (CLAUDE.md).
 *
 * That is two copies of the same data, which is only safe if something notices
 * when they diverge. This is that something: add a unit in code without a
 * matching migration and this fails.
 */

describe("seeded unit table", () => {
  it("holds exactly the units the matching engine knows about", async () => {
    const rows = await testDb().select().from(unit).orderBy(asc(unit.id));

    expect(rows.map((row) => row.id)).toEqual(Object.keys(UNITS).sort());
  });

  it("agrees with the matching engine on every dimension and conversion factor", async () => {
    const rows = await testDb().select().from(unit);
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const [key, expected] of Object.entries(UNITS)) {
      const row = byId.get(key);
      expect(row, `no seeded row for unit "${key}"`).toBeDefined();
      expect({ name: row?.name, dimension: row?.dimension, toBase: row?.toBase }).toEqual({
        name: expected.name,
        dimension: expected.dimension,
        toBase: expected.toBase,
      });
    }
  });
});
