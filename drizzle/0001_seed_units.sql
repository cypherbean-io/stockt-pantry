-- Reference data for the `unit` table.
--
-- These rows mirror `UNITS` in src/lib/matching/units.ts, which stays the
-- source of truth: the matching engine is pure logic and never reads this
-- table (CLAUDE.md), so the table exists only to give `pantry_item.unit_id`
-- and `recipe_ingredient.unit_id` something to reference.
--
-- Keeping the two in step is enforced by src/db/units-seed.test.ts, which
-- fails if a unit is added or a factor changed in code without a matching
-- migration here.
--
-- Idempotent, so re-running it after a factor is corrected converges rather
-- than erroring.

INSERT INTO "unit" ("id", "name", "dimension", "to_base") VALUES
  ('g',     'g',     'mass',   1),
  ('kg',    'kg',    'mass',   1000),
  ('oz',    'oz',    'mass',   28.349523125),
  ('lb',    'lb',    'mass',   453.59237),
  ('ml',    'mL',    'volume', 1),
  ('l',     'L',     'volume', 1000),
  ('cup',   'cup',   'volume', 236.5882365),
  ('tbsp',  'tbsp',  'volume', 14.78676478125),
  ('tsp',   'tsp',   'volume', 4.92892159375),
  ('count', 'count', 'count',  1)
ON CONFLICT ("id") DO UPDATE SET
  "name" = excluded."name",
  "dimension" = excluded."dimension",
  "to_base" = excluded."to_base";
