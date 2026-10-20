import { AuthPage } from "@/app/_components/fields";
import { LinkButton } from "@/app/_components/ui/button";
import { passwordResetFor } from "@/lib/auth/service";

import { ResetForm } from "./reset-form";

/**
 * Spending a password reset link a household member issued.
 *
 * Signed out by design — whoever has this link cannot sign in, which is why
 * they have it. As on `/join/[token]`, the check here only spares someone a
 * form behind a dead link; `resetPassword` re-tests the link inside the
 * transaction that spends it.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const account = await passwordResetFor(token);

  if (account === undefined) {
    return (
      <AuthPage
        title="This reset link is not valid"
        footer={
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Remembered it?
            <LinkButton href="/login" variant="secondary" size="sm">
              Sign in
            </LinkButton>
          </p>
        }
      >
        <p className="text-ink">
          It may have been used already, replaced by a newer one, or expired. Ask a member of
          your household for a fresh link.
        </p>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Choose a new password"
      description={`For ${account.email}. Saving it signs this account out everywhere and cancels any invite or reset links it made.`}
    >
      <ResetForm token={token} />
    </AuthPage>
  );
}
