"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOptionalActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import { revokeGoogleMailboxToken } from "@/server/mailbox/google-mailbox";
import { deleteCandidateMailboxConnection } from "@/server/mailbox/mailbox-connections";
import { openMailboxToken, readMailboxTokenKey } from "@/server/mailbox/token-crypto";

/** Removes RoleDawn's Gmail access and returns the grant to Google. */
export async function disconnectMailboxAction(): Promise<Readonly<{ ok: true } | { ok: false; message: string }>> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Sign in again to continue." };
  try {
    const client = await createSupabaseServerClient();
    const scope = await bootstrapPersonalWorkspace(client, actor, actor.email?.split("@")[0] ?? "");
    const removed = await deleteCandidateMailboxConnection(client, scope.candidateId);
    const key = readMailboxTokenKey();
    if (removed && key) {
      try { await revokeGoogleMailboxToken(openMailboxToken(removed.encryptedToken, key, scope.candidateId)); }
      catch { /* The record is gone either way; Google also lists the grant under the account's third-party access. */ }
    }
    revalidatePath("/vault/preferences");
    return { ok: true };
  } catch {
    return { ok: false, message: "Gmail couldn't be disconnected. Try again." };
  }
}
