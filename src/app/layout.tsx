import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { parseTheme, themeCookieName } from "@/lib/theme/cookie";

import { AppShell } from "./_components/shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Stockt Pantry",
  description: "What can I cook right now?",
};

/**
 * The root layout (SPEC.md §3.3, §3.4).
 *
 * The theme is read from the cookie here, before a byte of HTML is written, so
 * `data-theme` is already correct in the response and there is nothing to
 * correct on first paint. That is the whole reason it is a cookie: the usual
 * `localStorage` pattern needs a blocking inline `<script>` in `<head>`, which
 * is how so many apps end up needing `'unsafe-inline'` in their CSP.
 *
 * `"system"` renders no attribute at all rather than `data-theme="system"`.
 * The absence is what lets the `prefers-color-scheme` block in `globals.css`
 * take over; a literal "system" would match none of the three selectors and
 * pin the page to light on a dark OS.
 *
 * `AppShell` is chrome, not a check — see the comment at the top of
 * `_components/shell.tsx`. Pages keep their own.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(themeCookieName())?.value);

  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body className="min-h-dvh bg-surface font-sans text-ink antialiased">
        <AppShell theme={theme}>{children}</AppShell>
      </body>
    </html>
  );
}
