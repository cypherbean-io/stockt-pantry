/**
 * Tailwind v4 is a PostCSS plugin and nothing else. There is no
 * `tailwind.config.js` and no `content` globs to keep in sync — `@tailwindcss/oxide`
 * scans the source tree itself, which is also why it ships a native binary
 * (SPEC.md §3.1).
 *
 * Next 16 runs Turbopack for both `dev` and `build`, and Turbopack resolves the
 * project-root PostCSS config ahead of any per-directory one, so this file is
 * found without `experimental.turbopackLocalPostcssConfig` and `next.config.ts`
 * stays as it is. See
 * next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopackLocalPostcssConfig.md
 *
 * `.mjs` rather than `.js` is redundant — package.json already sets
 * `"type": "module"` — but it stops the module system being something a reader
 * has to go and confirm elsewhere.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
