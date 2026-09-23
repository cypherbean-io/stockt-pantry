import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

import { findHousehold } from "@/db/queries/household";
import { scopeForSession } from "@/db/scope";
import { currentSession } from "@/lib/auth/session";
import type { Theme } from "@/lib/theme/cookie";

import { AccountMenu } from "./account-menu";
import { Nav } from "./nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * The persistent app shell (SPEC.md §3.3).
 *
 * **This is presentation, never a gate.** A root layout does not re-render on
 * every navigation and does not control whether a nested segment renders, so
 * an auth check here would be decoration — it would look like protection
 * without being any. CLAUDE.md and `src/lib/auth/session.ts` both say so at
 * length. Every page keeps the check it has today, next to the data it reads,
 * and nothing in this file redirects or withholds `children`: both branches
 * below render them. `src/app/_components/shell.test.tsx` asserts that, and
 * asserts that every page touching tenant data still has its own call.
 *
 * `currentSession()` is wrapped in React `cache()`, so the shell and the page
 * it wraps share one session query per render pass rather than making two.
 *
 * Two costs worth naming rather than discovering later:
 *
 * - `findHousehold` is a second query per full page load, and `/household`
 *   runs it twice — once here, once in the page. It is a primary-key lookup on
 *   a table with one row per household, which is the right price for not
 *   restructuring that page around the header.
 * - Reading the theme cookie in the root layout makes `/login` and `/signup`
 *   dynamic. Every other route already is.
 */

const BAR = "border-b border-border bg-surface-raised";

const BAR_INNER = "mx-auto flex w-full max-w-4xl items-center gap-2 px-4 py-2";

function Wordmark({ householdName }: { readonly householdName?: string }): ReactElement {
  return (
    <Link
      href="/"
      className={
        "flex min-h-tap min-w-0 items-center gap-1.5 rounded-control px-1 text-base " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      }
    >
      <span className="font-semibold text-ink">Stockt</span>
      {/*
        Inline, unlike the email. In a deployment with several households the
        one you are writing to is a thing you should be able to see at all
        times — SPEC.md §4 calls that a safety feature, not a leak.
      */}
      {householdName !== undefined && (
        <span className="truncate text-ink-muted">· {householdName}</span>
      )}
    </Link>
  );
}

export function Header({
  householdName,
  email,
  theme,
}: {
  /** `findHousehold` answers `HouseholdRow | undefined`, so this may be absent. */
  readonly householdName?: string;
  readonly email: string;
  readonly theme: Theme;
}): ReactElement {
  return (
    <header className={BAR}>
      <div className={BAR_INNER}>
        <Wordmark householdName={householdName} />
        <div className="ml-auto flex items-center gap-1">
          <Nav />
          <ThemeToggle theme={theme} />
          <AccountMenu email={email} />
        </div>
      </div>
    </header>
  );
}

/**
 * The chrome for `/login`, `/signup` and `/join/[token]`: no navigation and no
 * account menu, because there is no session to name — but the theme control
 * stays. A sign-in page that cannot be read in the dark is the case the
 * control exists for, which is why `setThemeAction` requires no session.
 */
function SignedOutBar({ theme }: { readonly theme: Theme }): ReactElement {
  return (
    <header className={BAR}>
      <div className={BAR_INNER}>
        <Wordmark />
        <div className="ml-auto">
          <ThemeToggle theme={theme} />
        </div>
      </div>
    </header>
  );
}

export async function AppShell({
  theme,
  children,
}: {
  readonly theme: Theme;
  readonly children: ReactNode;
}): Promise<ReactElement> {
  const session = await currentSession();

  if (session === undefined) {
    return (
      <>
        <SignedOutBar theme={theme} />
        <main className="mx-auto w-full max-w-md px-4 py-10">{children}</main>
      </>
    );
  }

  const household = await findHousehold(scopeForSession(session));

  return (
    <>
      <Header householdName={household?.name} email={session.email} theme={theme} />
      {/*
        The app's one <main>. Pages render their own content and no landmark of
        their own — a <main> inside a <main> is invalid, and the second one is
        ignored by the "skip to content" affordance that makes the first useful.
      */}
      <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
    </>
  );
}
