import next from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "drizzle/**"] },
  ...next,
  ...typescript,

  /**
   * Tenant isolation, mechanised.
   *
   * `getDb()` hands back an unscoped query builder. `import "server-only"` keeps
   * it out of Client Components but does nothing to stop a server action or
   * route handler from writing `getDb().select().from(pantryItem)` with no
   * household predicate at all. That is the one invariant that must never be
   * violated (CLAUDE.md), and "we always remember to use the query layer" is not
   * an enforcement mechanism.
   *
   * So: reaching the raw handle from outside `src/db/**` is a lint failure. Add
   * a scoped function to `src/db/queries/` instead.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/client", "**/db/schema"],
              message:
                "Do not reach for the unscoped database handle or the raw tables. Use a scoped query from @/db/queries/* — every tenant query must carry a HouseholdScope (CLAUDE.md).",
            },
          ],
        },
      ],
    },
  },
];

export default config;
