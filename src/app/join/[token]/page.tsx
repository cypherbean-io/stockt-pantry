import Link from "next/link";

import { AuthPage } from "@/app/_components/fields";
import { inviteIsOpen } from "@/lib/auth/service";

import { JoinForm } from "./join-form";

/**
 * Redeeming an invite link (SPEC.md §2: the only way into an existing
 * household).
 *
 * The check here is a courtesy — it stops someone filling in a form behind a
 * dead link. It is not the enforcement: `joinWithInvite` re-tests used and
 * expired inside the transaction that claims the invite, so nothing gets in
 * through the gap between this render and that submit.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!(await inviteIsOpen(token))) {
    return (
      <AuthPage title="This invite is not valid">
        <p>
          It may have been used already, or expired. Ask a member of the household for a fresh
          link.
        </p>
        <p>
          <Link href="/login">Sign in</Link> if you already have an account.
        </p>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Join a household">
      <p>Pick the email address and password you will sign in with.</p>
      <JoinForm token={token} />
    </AuthPage>
  );
}
