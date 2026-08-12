"use server";

import { revalidatePath } from "next/cache";
import { normalizePublicJobUrl } from "@/domain/job-url";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import { parseSupportedJobReference } from "@/server/ingestion/job-reference";
import { enqueuePastedLinkApplication } from "@/server/dashboard/queue";

export type PastedLinkRunSummary = {
  normalizedJobUrl: string;
  status: "QUEUED";
  activePhase: "JOB_RESOLUTION_QUEUED";
  submissionAuthority: "NONE";
  persistence: "SUPABASE";
  replayed: boolean;
};

export type CreatePastedLinkRunResult =
  | { ok: true; value: PastedLinkRunSummary }
  | { ok: false; error: { code: string; message: string } };

/** Enqueues one supported public posting for the authenticated candidate. */
export async function createPastedLinkApplicationRun(
  input: Readonly<{
    commandId: string;
    jobUrl: string;
  }>,
): Promise<CreatePastedLinkRunResult> {
  const normalized = normalizePublicJobUrl(input.jobUrl);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  const normalizedForIdentity = normalized.value;

  if (!readSupabasePublicConfig()) {
    return {
      ok: false,
      error: {
        code: "BACKEND_CONFIGURATION_REQUIRED",
        message: "The database connection is not configured.",
      },
    };
  }

  const actor = await getOptionalActor();
  if (!actor) {
    return {
      ok: false,
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Sign in before adding a job to your persistent queue.",
      },
    };
  }

  const supportedReference = parseSupportedJobReference(normalizedForIdentity);
  if (!supportedReference.ok) {
    return {
      ok: false,
      error: {
        code: supportedReference.code,
        message: supportedReference.message,
      },
    };
  }

  // Persist one stable identity per supported ATS posting. Referral, tracking,
  // and application-page variants must not create duplicate work for a user.
  const canonicalJobUrl = supportedReference.value.canonicalInputUrl;

  const commandId = input.commandId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
    return {
      ok: false,
      error: {
        code: "COMMAND_ID_INVALID",
        message: "Refresh and try adding that job again.",
      },
    };
  }

  try {
    const result = await enqueuePastedLinkApplication(actor, {
      commandId,
      canonicalUrl: canonicalJobUrl,
    });
    revalidatePath("/dashboard");
    return {
      ok: true,
      value: {
        normalizedJobUrl: canonicalJobUrl,
        status: "QUEUED",
        activePhase: "JOB_RESOLUTION_QUEUED",
        submissionAuthority: "NONE",
        persistence: "SUPABASE",
        replayed: result.replayed,
      },
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "APPLICATION_ENQUEUE_FAILED";
    const backendIsNotReady =
      code === "WORKSPACE_BOOTSTRAP_UNAVAILABLE" ||
      code === "APPLICATION_ENQUEUE_UNAVAILABLE";
    return {
      ok: false,
      error: {
        code,
        message: backendIsNotReady
          ? "The queue database has not finished installing."
          : "We could not add that job. Try again.",
      },
    };
  }
}
