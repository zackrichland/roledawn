import "server-only";

import {
  CANDIDATE_ANSWER_FACT_KEYS,
  candidateFactDefinition,
  type CandidateFactKey,
  type CandidateFactValue,
  type CandidateProfileFactView,
  type CandidateProfileViewModel,
  isCandidateFactKey,
} from "@/domain/candidate-profile";
import {
  CandidateProfileError,
  normalizeCandidateFactValue,
} from "@/domain/candidate-profile-validation";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export { CandidateProfileError, normalizeCandidateFactValue } from "@/domain/candidate-profile-validation";

export type CandidateFactSaveCommand = Readonly<{
  commandId: string;
  key: CandidateFactKey;
  rawValue: string;
  expectedAggregateVersion: number | null;
}>;

function actorLabel(actor: AuthenticatedActor): string {
  return actor.email?.split("@")[0]?.trim().slice(0, 80) || "Signed-in candidate";
}

function readFactValue(value: Json, normalizedText: string | null, key: CandidateFactKey): CandidateFactValue | null {
  const rawValue = key.startsWith("work_authorization.")
    ? value === true ? "yes" : value === false ? "no" : value === "unsure" ? "unsure" : null
    : typeof value === "string" ? value : null;
  if (rawValue === null) return null;
  try {
    const normalized = normalizeCandidateFactValue(key, rawValue);
    if (normalized.normalizedText !== normalizedText || normalized.value !== value) return null;
    return normalized.value;
  } catch {
    return null;
  }
}

function displayValue(value: CandidateFactValue, key: CandidateFactKey): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === "unsure" && key.startsWith("work_authorization.")) return "I'm not sure";
  return value;
}

function databaseMessage(error: { code?: string; message?: string } | null): never {
  const serverCode = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/)?.[0] ?? error?.code;
  if (serverCode === "CANDIDATE_FACT_VERSION_MISMATCH") {
    throw new CandidateProfileError(serverCode, "This answer changed in another tab. Reload before saving.");
  }
  if (serverCode === "COMMAND_ID_PAYLOAD_MISMATCH") {
    throw new CandidateProfileError(serverCode, "This save request no longer matches. Reload and try again.");
  }
  throw new CandidateProfileError(serverCode ?? "CANDIDATE_FACT_SAVE_FAILED", "This answer could not be saved.");
}

export async function getCandidateProfile(
  actor: AuthenticatedActor,
): Promise<CandidateProfileViewModel> {
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));

  const { data: facts, error: factError } = await supabase
    .from("candidate_facts")
    .select("id, fact_key, sensitivity, usage_policy, verification_status, current_version_number, aggregate_version")
    .in("verification_status", ["VERIFIED", "NEEDS_REVIEW"])
    .order("fact_key", { ascending: true });
  if (factError) throw new CandidateProfileError("CANDIDATE_FACT_READ_FAILED", "Application answers could not be loaded.");

  const factRows = facts.filter((fact) => isCandidateFactKey(fact.fact_key) && fact.current_version_number !== null);
  const factIds = factRows.map((fact) => fact.id);
  const { data: versions, error: versionError } = factIds.length > 0
    ? await supabase
        .from("candidate_fact_versions")
        .select("id, fact_id, version_number, value_json, normalized_text, review_kind, reviewed_at")
        .in("fact_id", factIds)
        .eq("candidate_disposition", "APPROVED")
    : { data: [], error: null };
  if (versionError) throw new CandidateProfileError("CANDIDATE_FACT_READ_FAILED", "Application answers could not be loaded.");

  const versionsByFact = new Map(versions.map((version) => [`${version.fact_id}:${version.version_number}`, version] as const));
  const views: CandidateProfileFactView[] = [];
  for (const fact of factRows) {
    if (!isCandidateFactKey(fact.fact_key) || fact.current_version_number === null) continue;
    const version = versionsByFact.get(`${fact.id}:${fact.current_version_number}`);
    if (!version || !version.reviewed_at) continue;
    const value = readFactValue(version.value_json, version.normalized_text, fact.fact_key);
    if (value === null) continue;
    const definition = candidateFactDefinition(fact.fact_key);
    if (fact.sensitivity !== definition.sensitivity || fact.usage_policy !== definition.usagePolicy) continue;
    views.push(Object.freeze({
      factId: fact.id,
      factVersionId: version.id,
      key: fact.fact_key,
      label: definition.label,
      value,
      displayValue: displayValue(value, fact.fact_key),
      sensitivity: definition.sensitivity,
      usagePolicy: definition.usagePolicy,
      aggregateVersion: fact.aggregate_version,
      factVersionNumber: version.version_number,
      reviewedAt: version.reviewed_at,
      sourceKind: version.review_kind === "RESUME_EVIDENCE" ? "RESUME_EVIDENCE" : "CANDIDATE_ENTRY",
      resolved: fact.verification_status === "VERIFIED" && value !== "unsure",
    }));
  }

  return Object.freeze({
    actorLabel: actorLabel(actor),
    accountEmail: actor.email,
    facts: Object.freeze(views),
  });
}

export async function saveCandidateFact(
  actor: AuthenticatedActor,
  command: CandidateFactSaveCommand,
): Promise<void> {
  if (!UUID_PATTERN.test(command.commandId)) {
    throw new CandidateProfileError("CANDIDATE_FACT_COMMAND_INVALID", "Reload before saving this answer.", command.key);
  }
  if (
    command.expectedAggregateVersion !== null &&
    (!Number.isSafeInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion < 1)
  ) {
    throw new CandidateProfileError("CANDIDATE_FACT_VERSION_INVALID", "Reload before saving this answer.", command.key);
  }
  const normalized = normalizeCandidateFactValue(command.key, command.rawValue);
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));
  const rpcArguments = {
    p_command_id: command.commandId,
    p_fact_key: command.key,
    p_value_json: normalized.value,
    p_normalized_text: normalized.normalizedText,
    ...(command.expectedAggregateVersion === null
      ? {}
      : { p_expected_aggregate_version: command.expectedAggregateVersion }),
  };
  const rpc = command.key === "identity.given_name" || command.key === "identity.family_name"
    ? "save_candidate_identity_name_fact"
    : CANDIDATE_ANSWER_FACT_KEYS.has(command.key) ? "save_candidate_answer_fact" : "save_candidate_fact";
  const { error } = await supabase.rpc(rpc, rpcArguments);
  if (error) databaseMessage(error);
}
