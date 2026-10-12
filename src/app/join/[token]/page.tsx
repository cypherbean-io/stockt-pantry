import { AuthPage } from "@/app/_components/fields";
import { LinkButton } from "@/app/_components/ui/button";
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
      <AuthPage
        title="This invite is not valid"
        footer={
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Already have an account?
            <LinkButton href="/login" variant="secondary" size="sm">
              Sign in
            </LinkButton>
          </p>
        }
      >
        <p className="text-ink">
          It may have been used already, or expired. Ask a member of the household for a fresh
          link.
        </p>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Join a household"
      description="Pick the email address and password you will sign in with."
    >
      <JoinForm token={token} />
    </AuthPage>
  );
}
