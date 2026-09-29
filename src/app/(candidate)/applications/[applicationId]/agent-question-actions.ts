"use server";

import { revalidatePath } from "next/cache";

import { ApplicationAgentQuestionError, type SaveAgentQuestionAnswersCommand } from "@/domain/application-agent-questions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveApplicationAgentAnswersAndResume } from "@/server/applications/agent-questions";
import { getOptionalActor } from "@/server/auth/session";

export async function saveApplicationAgentAnswersAction(
  command: SaveAgentQuestionAnswersCommand,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: string; message: string }>> {
  if (process.env.ROLEDAWN_FORM_DRIVER !== "agents") {
    return { ok: false, code: "APPLICATION_AGENT_QUESTIONS_DISABLED", message: "Application questions are not enabled." };
  }
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, code: "AUTHENTICATION_REQUIRED", message: "Sign in again before saving these details." };
  try {
    await saveApplicationAgentAnswersAndResume(await createSupabaseServerClient(), command);
    revalidatePath("/dashboard");
    revalidatePath(`/applications/${command.applicationId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof ApplicationAgentQuestionError ? error.code : "APPLICATION_AGENT_ANSWER_FAILED",
      message: error instanceof ApplicationAgentQuestionError
        ? error.message
        : "RoleDawn could not confirm that these details were saved. Try again to check the same request.",
    };
  }
}
