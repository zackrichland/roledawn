"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { ApplicationAutopilotError, type ControlAutopilotCommand, type DelegateApplicationAutopilotCommand, type SaveAutopilotAnswersCommand } from "@/domain/application-autopilot";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { controlApplicationAutopilot, delegateApplicationAutopilot, provideApplicationAutopilotVerificationCode, saveApplicationAutopilotAnswers } from "@/server/applications/autopilot";
import { getOptionalActor } from "@/server/auth/session";
import { requestHostedWorkerWakeup } from "@/server/workers/hosted-worker-wakeup";

type Result = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;
async function execute(action: (client: Awaited<ReturnType<typeof createSupabaseServerClient>>) => Promise<unknown>, wakeAutopilot = false): Promise<Result> {
  if (process.env.ROLEDAWN_AUTOPILOT_ENABLED !== "true") return { ok: false, message: "Apply for me is not available yet." };
  if (!await getOptionalActor()) return { ok: false, message: "Sign in again to continue." };
  try {
    await action(await createSupabaseServerClient());
    // The command must commit first. The published worker's due query and
    // database lease still decide whether any saved work can continue.
    if (wakeAutopilot) after(() => requestHostedWorkerWakeup(["autopilot"]));
    revalidatePath("/dashboard"); revalidatePath("/applications/[applicationId]", "page");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof ApplicationAutopilotError ? error.message : "The request could not be confirmed. Retry to check the same request." };
  }
}
export async function delegateApplicationAutopilotAction(command: DelegateApplicationAutopilotCommand): Promise<Result> {
  return execute(client => delegateApplicationAutopilot(client, command), true);
}
export async function saveApplicationAutopilotAnswersAction(command: SaveAutopilotAnswersCommand): Promise<Result> {
  return execute(client => saveApplicationAutopilotAnswers(client, command), true);
}
export async function controlApplicationAutopilotAction(command: ControlAutopilotCommand): Promise<Result> {
  return execute(client => controlApplicationAutopilot(client, command), command.action === "RESUME");
}
export async function provideApplicationAutopilotVerificationCodeAction(command: Readonly<{ commandId: string; id: string; verificationId: string; code: string }>): Promise<Result> {
  return execute(client => provideApplicationAutopilotVerificationCode(client, command), true);
}
