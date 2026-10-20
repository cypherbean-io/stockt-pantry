"use client";

import { useState, useTransition } from "react";

import { createPasswordResetAction, type ResetLinkState } from "@/app/actions/auth";
import { Button } from "@/app/_components/ui/button";
import { FormMessage } from "@/app/_components/ui/field";

import { IssuedInvite } from "./invite-button";

/**
 * Generate a password reset link for one member and show it once — the same
 * shape as `InviteButton`, origin filled in here for the same reason.
 *
 * `IssuedInvite` draws the link because everything it says holds for this one
 * too: shown once, works once, expires, send it over a channel you trust.
 */
export function ResetLinkButton({ memberId }: { readonly memberId: string }) {
  const [link, setLink] = useState<ResetLinkState>(undefined);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    startTransition(async () => {
      setLink(await createPasswordResetAction(memberId));
    });
  };

  return (
    <div className="flex w-full flex-col items-start gap-4">
      <Button variant="secondary" onClick={generate} disabled={pending}>
        {pending ? "Generating…" : "Generate a reset link"}
      </Button>

      {link !== undefined &&
        ("refused" in link ? (
          <FormMessage message="No link was made. Reload the page to see who is still in the household." />
        ) : (
          <IssuedInvite
            link={typeof window === "undefined" ? link.path : window.location.origin + link.path}
            expiresAt={link.expiresAt}
          />
        ))}
    </div>
  );
}
