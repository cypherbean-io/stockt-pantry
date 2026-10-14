import type { Page, Response } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * The theme, with no flash (SPEC.md §5 Smoke 3, §3.4).
 *
 * `cookie.test.ts` and `theme-toggle.test.tsx` already pin the allowlist, the
 * flags and the three-state cycle without a browser. What only a browser can
 * show is the claim the cookie design exists to make: that the theme a user
 * chose is in the **first byte of HTML**, so nothing has to correct it after
 * paint. That is asserted on the served response rather than by sampling a
 * screenshot at first paint, which is the deterministic version of the same
 * claim.
 *
 * Every test starts with the OS in dark mode and no theme cookie — signup
 * never sets one, and each test gets a fresh context from `storageState`.
 */

test.use({ colorScheme: "dark" });

/**
 * The production build's name for it. `__Host-` because the standalone server
 * runs with `NODE_ENV=production`, which is what makes `secureCookies()` true —
 * see the note at the top of `playwright.config.ts`. Written out rather than
 * imported, so a renamed cookie fails here instead of being followed.
 */
const THEME_COOKIE = "__Host-stockt_theme";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Either side of the middle, not exact token values: the light `--surface` is
 * near white and the dark one near black, and the question here is which of
 * the two the browser painted, not whether a token was retuned.
 */
const DARK_BELOW = 0.2;
const LIGHT_ABOVE = 0.8;

/**
 * WCAG relative luminance of the page background, as the browser resolved it.
 *
 * Through a canvas because `getComputedStyle` answers in the colour space the
 * token was written in — `oklch(…)` here — and a 2D canvas converts whatever
 * it is given to sRGB bytes. That keeps this independent of how the tokens are
 * spelled.
 */
function backgroundLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (context === null) throw new Error("No 2D canvas context");

    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

    const linear = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  });
}

/** The opening `<html …>` tag of a served document. */
function htmlTag(document: string): string {
  const tag = /<html\b[^>]*>/i.exec(document)?.[0];
  if (tag === undefined) throw new Error("The response has no <html> tag.");
  return tag;
}

/**
 * Presses the control from System to Light and answers the `Set-Cookie` line
 * the action sent back for the theme. Every test that needs a chosen theme
 * goes through the real control rather than planting the cookie, so the
 * cookie under test is one the app wrote.
 */
async function chooseLight(page: Page): Promise<string> {
  await page.goto("/recipes");

  // `headerValue("set-cookie")` joins several cookies with newlines.
  const themeLine = async (response: Response): Promise<string | undefined> =>
    ((await response.headerValue("set-cookie")) ?? "")
      .split("\n")
      .find((line) => line.startsWith(`${THEME_COOKIE}=`));

  const persisted = page.waitForResponse(
    async (response) =>
      response.request().method() === "POST" && (await themeLine(response)) !== undefined,
  );

  // With no cookie the control is on System, and pressing it goes to Light.
  await page.getByRole("button", { name: "Theme: System. Switch to Light." }).click();

  const line = await themeLine(await persisted);
  if (line === undefined) throw new Error("The theme action set no theme cookie.");
  return line;
}

test("follows a dark OS when no theme has been chosen", async ({ page, context }) => {
  expect(
    (await context.cookies()).filter(({ name }) => name.endsWith("stockt_theme")),
    "precondition: no theme cookie",
  ).toEqual([]);

  const response = await page.goto("/recipes");
  if (response === null) throw new Error("No response for /recipes");

  // Dark with no attribute at all: it is the `prefers-color-scheme` block in
  // globals.css doing it, not a value the server guessed.
  expect(htmlTag(await response.text())).not.toContain("data-theme");
  expect(await backgroundLuminance(page)).toBeLessThan(DARK_BELOW);
});

test("switches to Light at once on a dark OS", async ({ page }) => {
  await page.goto("/recipes");
  await page.getByRole("button", { name: "Theme: System. Switch to Light." }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // Light on a dark OS: the `:not([data-theme="light"])` exclusion working.
  await expect.poll(() => backgroundLuminance(page)).toBeGreaterThan(LIGHT_ABOVE);
  await expect(page.getByRole("button", { name: "Theme: Light. Switch to Dark." })).toBeVisible();
});

test("persists the choice in a host-only, HttpOnly, Secure, Lax cookie that lasts a year", async ({
  page,
  context,
}) => {
  const setCookie = await chooseLight(page);

  // A year, as the server sent it. `Max-Age` rather than the browser's derived
  // expiry, which would mean comparing two clocks.
  expect(setCookie).toMatch(new RegExp(`;\\s*Max-Age=${ONE_YEAR_SECONDS}(?:;|$)`, "i"));

  // And as the browser stored it.
  const cookie = (await context.cookies()).find(({ name }) => name === THEME_COOKIE);
  expect(cookie).toMatchObject({
    value: "light",
    // Host-only: `__Host-` forbids a Domain attribute, and Playwright reports a
    // domain cookie with a leading dot.
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
});

test("serves the chosen theme in the first byte of HTML after a reload", async ({ page }) => {
  await chooseLight(page);

  const reloaded = await page.reload();
  if (reloaded === null) throw new Error("No response for the reload");

  // The no-flash guarantee itself: the attribute is in the HTML the server
  // sent, before any script has run.
  expect(htmlTag(await reloaded.text())).toMatch(/\sdata-theme="light"/);
  expect(await backgroundLuminance(page)).toBeGreaterThan(LIGHT_ABOVE);
});

test("serves no script in <head> that could set the theme before first paint", async ({ page }) => {
  const response = await page.goto("/recipes");
  if (response === null) throw new Error("No response for /recipes");

  // The *served* document, parsed — not the live DOM, where the client runtime
  // has since appended chunk scripts of its own. Those load after paint and say
  // nothing about what ran before it.
  const offenders = await page.evaluate((served) => {
    const head = new DOMParser().parseFromString(served, "text/html").head;

    return [...head.querySelectorAll("script")]
      .filter((script) => {
        // An inline script runs before the parser continues, which is exactly
        // the `localStorage`-plus-blocking-script pattern SPEC.md §3.10 rejects.
        if (script.src === "") {
          return /theme|color-?scheme|localStorage|matchMedia/i.test(script.text);
        }
        // An external one can only run before paint if it blocks the parser;
        // its source is not visible from here, so blocking is the offence.
        return !(script.async || script.defer || script.noModule || script.type === "module");
      })
      .map((script) => script.outerHTML.slice(0, 200));
  }, await response.text());

  expect(offenders, "SPEC.md §3.4: the theme is a cookie, not a script in <head>").toEqual([]);
});
