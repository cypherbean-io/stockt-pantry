"use client";

import { useState, useTransition } from "react";

import { createInviteAction, type InviteState } from "@/app/actions/auth";
import { PlusIcon } from "@/app/_components/icons";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";

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
    <div className="flex flex-col items-start gap-4">
      <Button variant="secondary" onClick={generate} disabled={pending}>
        <PlusIcon className="shrink-0" />
        {pending ? "Generating…" : "Generate an invite link"}
      </Button>

      {invite !== undefined && (
        <IssuedInvite
          link={typeof window === "undefined" ? invite.path : window.location.origin + invite.path}
          expiresAt={invite.expiresAt}
        />
      )}
    </div>
  );
}

/**
 * The link, once. Its own component so it can be rendered without a click —
 * the state above is only reachable through a server action.
 */
export function IssuedInvite({
  link,
  expiresAt,
}: {
  readonly link: string;
  /** ISO 8601, as `createInviteAction` returns it. */
  readonly expiresAt: string;
}) {
  return (
    <Card className="flex w-full flex-col gap-3">
      <p className="text-ink">
        <strong className="font-semibold">Copy this now.</strong> It is shown once, works once,
        and expires {new Date(expiresAt).toLocaleString()}.
      </p>
      {/*
        `wrap-anywhere` because the token is one long word, and a phone would
        otherwise scroll sideways to show it. `select-all` so one tap selects
        the whole link, not the word under the finger.
      */}
      <code className="block rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm text-ink wrap-anywhere select-all">
        {link}
      </code>
      <p className="text-sm text-ink-muted">
        Send it over a channel you trust. This app sends no email.
      </p>
    </Card>
  );
}
