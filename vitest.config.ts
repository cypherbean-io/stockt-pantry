import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `import "server-only"` is a marker Next.js resolves internally rather than
  // an npm dependency, so outside Next it has to be pointed at the same no-op
  // module Next aliases it to.
  "server-only": fileURLToPath(
    new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url),
  ),
};

/**
 * Two projects, split by what a test *needs* rather than where it lives.
 *
 * A test named `*.db.test.ts` talks to a real Postgres in Docker; everything
 * else is pure logic and runs with nothing installed. That is why the suffix
 * exists rather than a directory rule — `src/db/validate.ts` is pure, and its
 * test has no business starting a container.
 *
 * The `db` project runs its files one at a time: they share one database and
 * truncate it between tests.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: [...defaultExclude, "src/**/*.db.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["./src/db/testing/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          // First run pulls the Postgres image and runs initdb.
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
