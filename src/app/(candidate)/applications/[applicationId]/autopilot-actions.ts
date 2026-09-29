"use server";

import { revalidatePath } from "next/cache";
import { ApplicationAutopilotError, type ControlAutopilotCommand, type DelegateApplicationAutopilotCommand, type SaveAutopilotAnswersCommand } from "@/domain/application-autopilot";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { controlApplicationAutopilot, delegateApplicationAutopilot, provideApplicationAutopilotVerificationCode, saveApplicationAutopilotAnswers } from "@/server/applications/autopilot";
import { getOptionalActor } from "@/server/auth/session";

type Result = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;
async function execute(action: (client: Awaited<ReturnType<typeof createSupabaseServerClient>>) => Promise<unknown>): Promise<Result> {
  if (process.env.ROLEDAWN_AUTOPILOT_ENABLED !== "true") return { ok: false, message: "Apply for me is not available yet." };
  if (!await getOptionalActor()) return { ok: false, message: "Sign in again to continue." };
  try {
    await action(await createSupabaseServerClient());
    revalidatePath("/dashboard"); revalidatePath("/applications/[applicationId]", "page");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof ApplicationAutopilotError ? error.message : "The request could not be confirmed. Retry to check the same request." };
  }
}
export async function delegateApplicationAutopilotAction(command: DelegateApplicationAutopilotCommand): Promise<Result> {
  return execute(client => delegateApplicationAutopilot(client, command));
}
export async function saveApplicationAutopilotAnswersAction(command: SaveAutopilotAnswersCommand): Promise<Result> {
  return execute(client => saveApplicationAutopilotAnswers(client, command));
}
export async function controlApplicationAutopilotAction(command: ControlAutopilotCommand): Promise<Result> {
  return execute(client => controlApplicationAutopilot(client, command));
}
export async function provideApplicationAutopilotVerificationCodeAction(command: Readonly<{ commandId: string; id: string; verificationId: string; code: string }>): Promise<Result> {
  return execute(client => provideApplicationAutopilotVerificationCode(client, command));
}
