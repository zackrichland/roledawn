"use server";

import { getOptionalActor } from "@/server/auth/session";
import { getJobDetail, type JobDetail } from "@/server/opportunities/jobs-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function getJobDetailAction(jobVersionId: string): Promise<Readonly<{ ok: true; job: JobDetail } | { ok: false; message: string }>> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Your session ended. Reload the page." };
  if (!UUID.test(jobVersionId)) return { ok: false, message: "That job link is invalid." };
  const job = await getJobDetail(jobVersionId).catch(() => null);
  return job ? { ok: true, job } : { ok: false, message: "This job couldn't be loaded. It may have closed." };
}
