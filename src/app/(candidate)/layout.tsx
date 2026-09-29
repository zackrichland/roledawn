import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { signOut } from "@/app/dashboard/sign-out-action";
import { AuthenticatedAppShell, type AutopilotIndicator } from "@/components/ui/AuthenticatedAppShell";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOptionalActor } from "@/server/auth/session";
import { readAutoApplyState } from "@/server/auto-apply/state";
import { readCandidateAccountState } from "@/server/candidate/account";
import { readSingleAccountConfig } from "@/server/auth/single-account-policy";

async function autopilotIndicator(): Promise<AutopilotIndicator> {
  try {
    const state = await readAutoApplyState(await createSupabaseServerClient());
    return state.enabled ? "ON" : state.status === "PAUSED_PROFILE_CHANGED" ? "PAUSED" : "OFF";
  } catch {
    return null;
  }
}

export default async function CandidateLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!readSupabasePublicConfig()) return children;

  const actor = await getOptionalActor();
  if (!actor) return children;
  const account = await readCandidateAccountState(actor);
  if (!account || account.status === "ONBOARDING") redirect("/onboarding");

  return (
    <AuthenticatedAppShell
      actorLabel={account.displayName}
      autopilot={await autopilotIndicator()}
      signOutAction={signOut}
      hideAccount={Boolean(readSingleAccountConfig())}
    >
      {children}
    </AuthenticatedAppShell>
  );
}
