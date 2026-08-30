"use client";

import { useState, useTransition } from "react";

import { createInviteAction, type InviteState } from "@/app/actions/auth";

/**
 * Generate an invite and show the link once.
 *
 * The action returns a path; the absolute URL is assembled here from
 * `window.location.origin`, so the link the user copies never depends on a
 * `Host` header the server was handed. There is no "show me that invite again"
 * — the database only holds the hash.
 */
export function InviteButton() {
  const [invite, setInvite] = useState<InviteState>(undefined);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    startTransition(async () => {
      setInvite(await createInviteAction());
    });
  };

  return (
    <div>
      <button type="button" onClick={generate} disabled={pending}>
        {pending ? "Generating…" : "Generate an invite link"}
      </button>

      {invite !== undefined && (
        <div>
          <p>
            <strong>Copy this now.</strong> It is shown once, works once, and expires{" "}
            {new Date(invite.expiresAt).toLocaleString()}.
          </p>
          <p>
            <code style={{ overflowWrap: "anywhere" }}>
              {typeof window === "undefined" ? invite.path : window.location.origin + invite.path}
            </code>
          </p>
          <p>
            <small>Send it over a channel you trust. This app sends no email.</small>
          </p>
        </div>
      )}
    </div>
  );
}
