import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { saveCandidateSearchProfileAction } from "@/app/onboarding/actions";
import { SearchGoals } from "@/components/onboarding/SearchGoals";
import { MailboxConnectionCard } from "@/components/profile/MailboxConnectionCard";
import styles from "@/components/profile/Profile.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOptionalActor } from "@/server/auth/session";
import { getCandidateOnboarding } from "@/server/candidate/onboarding";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import { readGoogleMailboxConfig } from "@/server/mailbox/google-mailbox";
import { getCandidateMailboxConnection, type CandidateMailboxConnection } from "@/server/mailbox/mailbox-connections";
import { readMailboxTokenKey } from "@/server/mailbox/token-crypto";

export const metadata: Metadata = {
  title: "Preferences",
  description: "The roles, places, and ways of working RoleDawn looks for.",
};

async function loadMailbox(actor: NonNullable<Awaited<ReturnType<typeof getOptionalActor>>>): Promise<CandidateMailboxConnection | null> {
  try {
    const client = await createSupabaseServerClient();
    const scope = await bootstrapPersonalWorkspace(client, actor, actor.email?.split("@")[0] ?? "");
    return await getCandidateMailboxConnection(client, scope.candidateId);
  } catch { return null; }
}

export default async function PreferencesPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/vault/preferences");
  const [onboarding, mailbox, params] = await Promise.all([getCandidateOnboarding(actor), loadMailbox(actor), searchParams]);
  let available = false;
  try { available = Boolean(readGoogleMailboxConfig() && readMailboxTokenKey()); } catch { available = false; }
  const status = typeof params.mailbox === "string" ? params.mailbox : undefined;
  return (
    <>
      <MailboxConnectionCard available={available} connection={mailbox} status={status} />
      <section className={styles.card}>
        <SearchGoals
          action={saveCandidateSearchProfileAction}
          commandId={randomUUID()}
          key={onboarding.searchProfile.aggregateVersion ?? "new"}
          mode="settings"
          profile={onboarding.searchProfile}
        />
        <p className={styles.muted}>Changing these pauses autopilot until you turn it back on, so nothing is sent against old targets.</p>
      </section>
    </>
  );
}
