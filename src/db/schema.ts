import { sql, type SQL } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type PgColumn,
} from "drizzle-orm/pg-core";

/**
 * The data model from SPEC.md §3.
 *
 * Two things here are load-bearing for tenant isolation (SPEC.md §4) and should
 * not be simplified away:
 *
 * 1. Every tenant table carries `household_id` directly — including
 *    `recipe_ingredient`, which SPEC.md's conceptual model reaches only through
 *    `recipe`. Denormalising it means the scoping predicate is one column on
 *    one table rather than a join the caller has to remember to write.
 * 2. The foreign keys out of `pantry_item` and `recipe_ingredient` are
 *    *composite* — `(household_id, ingredient_id)` rather than
 *    `(ingredient_id)`. Postgres then refuses to store a row that points at
 *    another household's catalog entry at all, so a bug in the query layer
 *    cannot quietly produce cross-linked data. The query layer is the control;
 *    this is the backstop.
 */

export const dimension = pgEnum("dimension", ["mass", "volume", "count"]);

/**
 * `> 0` is not enough on a float column. Postgres sorts `NaN` above every other
 * float8, so `'NaN'::float8 > 0` is true, and `Infinity > 0` is true for the
 * obvious reason — postgres.js passes both straight through from JS. A stored
 * `Infinity` would make `matchLine` report "have" for an ingredient nobody has,
 * and a stored `NaN` density slips past the `<= 0` guard in `convert` and
 * returns `NaN` instead of the "can't verify" null the spec requires.
 *
 * Comparing against `Infinity` excludes both: `NaN < Infinity` is false.
 */
function positiveFinite(column: PgColumn): SQL {
  return sql`${column} > 0 AND ${column} < 'Infinity'::float8`;
}

export const household = pgTable("household", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const user = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Addresses are compared case-insensitively, so the unique constraint above
    // only means anything if they are stored normalised. Normalise with SQL
    // `lower()` in the auth slice too — JS `toLowerCase()` disagrees with it on
    // a few codepoints (U+0130 being the classic) and the mismatch shows up as
    // a login that fails rather than as an error.
    check("user_email_lowercase", sql`${table.email} = lower(${table.email})`),
    index("user_household_idx").on(table.householdId),
    // Target of invite's composite foreign key.
    unique("user_household_id_unique").on(table.householdId, table.id),
  ],
);

export const invite = pgTable(
  "invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    /**
     * The hash of the invite token, never the token itself. The raw value is
     * shown once at generation time and then only exists in the link the user
     * shares out-of-band, so a database read cannot mint a working invite.
     */
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invite_household_idx").on(table.householdId),
    // Composite like every other cross-table key here, so an invite cannot name
    // another household's member as its creator. Nullable creator is still
    // allowed: a composite foreign key with any NULL column is not checked.
    // Cascade rather than set-null because set-null on a composite key nulls
    // every column, and `household_id` is NOT NULL — deleting a member revokes
    // the invites they issued, which is the safer default anyway.
    foreignKey({
      name: "invite_household_created_by_fk",
      columns: [table.householdId, table.createdBy],
      foreignColumns: [user.householdId, user.id],
    }).onDelete("cascade"),
  ],
);

export const session = pgTable(
  "session",
  {
    /**
     * The SHA-256 of the token in the cookie, never the token. A database read
     * — a backup, a dump, a stray log line — therefore cannot be replayed as a
     * live session. It doubles as the primary key because every lookup is by
     * exactly this value.
     */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull(),
    /**
     * Denormalised from `user` for the same reason `recipe_ingredient` carries
     * it: resolving a cookie to a `HouseholdScope` is then one indexed row read
     * with no join, on the hot path of every authenticated request. The
     * composite foreign key below is what keeps it honest — a session cannot
     * name a household its user does not belong to.
     */
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "session_household_user_fk",
      columns: [table.householdId, table.userId],
      foreignColumns: [user.householdId, user.id],
    }).onDelete("cascade"),
    // Postgres does not index the referencing side of a foreign key, so without
    // this both "sign this member out everywhere" and the cascade from a
    // deleted member are seq scans.
    index("session_household_user_idx").on(table.householdId, table.userId),
    // Supports sweeping expired rows; expiry itself is enforced by the
    // `expires_at > now` predicate on the lookup, not by the sweep.
    index("session_expires_idx").on(table.expiresAt),
  ],
);

/**
 * Units are deployment-wide reference data, not tenant data — there is nothing
 * household-specific about a gram. The primary key is the unit's key rather
 * than a surrogate id so the rows line up with `UNITS` in
 * `src/lib/matching/units.ts`, which stays the source of truth for the
 * conversion factors. The rows are seeded by a migration and
 * `units-seed.test.ts` fails if the two ever disagree.
 */
export const unit = pgTable("unit", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dimension: dimension("dimension").notNull(),
  toBase: doublePrecision("to_base").notNull(),
});

export const ingredient = pgTable(
  "ingredient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Null means mass<->volume conversion is "can't verify" for this item. */
    densityGPerMl: doublePrecision("density_g_per_ml"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("ingredient_household_name_unique").on(table.householdId, table.name),
    // Target of the composite foreign keys below.
    unique("ingredient_household_id_unique").on(table.householdId, table.id),
    check("ingredient_density_positive", positiveFinite(table.densityGPerMl)),
  ],
);

export const pantryItem = pgTable(
  "pantry_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    unitId: text("unit_id")
      .notNull()
      .references(() => unit.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "pantry_item_household_ingredient_fk",
      columns: [table.householdId, table.ingredientId],
      foreignColumns: [ingredient.householdId, ingredient.id],
    }).onDelete("cascade"),
    // The matching engine looks up at most one pantry row per ingredient.
    unique("pantry_item_household_ingredient_unique").on(table.householdId, table.ingredientId),
    check("pantry_item_quantity_positive", positiveFinite(table.quantity)),
  ],
);

export const recipe = pgTable(
  "recipe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseServings: integer("base_servings").notNull(),
    /** Ordered free text; array position is the step number. */
    steps: text("steps").array().notNull().default([]),
    /** Set only when the recipe came in through the import flow. */
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("recipe_household_id_unique").on(table.householdId, table.id),
    check("recipe_base_servings_positive", sql`${table.baseServings} > 0`),
  ],
);

export const recipeIngredient = pgTable(
  "recipe_ingredient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id").notNull(),
    ingredientId: uuid("ingredient_id").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    unitId: text("unit_id")
      .notNull()
      .references(() => unit.id),
  },
  (table) => [
    foreignKey({
      name: "recipe_ingredient_household_recipe_fk",
      columns: [table.householdId, table.recipeId],
      foreignColumns: [recipe.householdId, recipe.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "recipe_ingredient_household_ingredient_fk",
      columns: [table.householdId, table.ingredientId],
      foreignColumns: [ingredient.householdId, ingredient.id],
    }).onDelete("cascade"),
    unique("recipe_ingredient_recipe_ingredient_unique").on(table.recipeId, table.ingredientId),
    // Postgres indexes the referenced side of a foreign key, never the
    // referencing side. Without these, every scoped read of a recipe's lines —
    // and every cascade from a deleted recipe or ingredient — is a seq scan.
    index("recipe_ingredient_household_recipe_idx").on(table.householdId, table.recipeId),
    index("recipe_ingredient_household_ingredient_idx").on(table.householdId, table.ingredientId),
    check("recipe_ingredient_quantity_positive", positiveFinite(table.quantity)),
  ],
);

export type HouseholdRow = typeof household.$inferSelect;
export type UserRow = typeof user.$inferSelect;
export type InviteRow = typeof invite.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
export type UnitRow = typeof unit.$inferSelect;
export type IngredientRow = typeof ingredient.$inferSelect;
export type PantryItemRow = typeof pantryItem.$inferSelect;
export type RecipeRow = typeof recipe.$inferSelect;
export type RecipeIngredientRow = typeof recipeIngredient.$inferSelect;
