"use server";

import type { ApplicationAutopilotView } from "@/domain/application-autopilot";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getApplicationAutopilot } from "@/server/applications/autopilot";
import { getOptionalActor } from "@/server/auth/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The live send state for one application, so Home can resolve what it needs in place. */
export async function loadApplicationNeedAction(applicationId: string): Promise<Readonly<{ ok: true; view: ApplicationAutopilotView | null } | { ok: false; message: string }>> {
  if (!await getOptionalActor()) return { ok: false, message: "Your session ended. Reload the page." };
  if (!UUID.test(applicationId)) return { ok: false, message: "That application link is invalid." };
  try {
    // Turning off new sends must not hide an existing send's questions/codes.
    const view = await getApplicationAutopilot(await createSupabaseServerClient(), applicationId);
    return { ok: true, view };
  } catch {
    return { ok: false, message: "This application couldn’t be loaded. Open it to continue." };
  }
}
