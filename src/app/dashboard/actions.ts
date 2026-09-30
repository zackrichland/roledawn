"use server";

import { revalidatePath } from "next/cache";
import { getOptionalActor } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AutoApplyError, type AutoApplyState, type SetAutoApplyCommand } from "@/domain/account-auto-apply";
import { setAutoApplyEnabled } from "@/server/auto-apply/state";

export async function setAccountAutoApply(input: SetAutoApplyCommand): Promise<
  { ok: true; value: AutoApplyState } | { ok: false; message: string }
> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Sign in again before changing auto-apply." };
  try {
    const value = await setAutoApplyEnabled(await createSupabaseServerClient(), input);
    revalidatePath("/dashboard");
    return { ok: true, value };
  } catch (error) {
    const code = error instanceof AutoApplyError ? error.code : "";
    const message = code.includes("VERSION") || code.includes("STALE") ? "This setting changed in another tab. Refresh before trying again."
      : code.includes("PROFILE") || code.includes("ONBOARDING") ? "Finish your profile and job preferences before turning on auto-apply."
      : code === "AUTO_APPLY_UNAVAILABLE" ? "Auto-apply is being installed. Try again shortly."
      : "We could not confirm the change. Refresh to check the current setting.";
    return { ok: false, message };
  }
}
