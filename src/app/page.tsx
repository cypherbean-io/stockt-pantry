import { redirect } from "next/navigation";

import { currentSession } from "@/lib/auth/session";

/**
 * The front door. There is nothing to show an anonymous visitor — SPEC.md §2
 * rules out public signup, so a marketing page would only be a link to a form
 * that will refuse them.
 */
export default async function Home() {
  redirect((await currentSession()) === undefined ? "/login" : "/recipes");
}
