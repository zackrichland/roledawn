import type { SupabaseClient } from "@supabase/supabase-js";

import type { DocumentExactFacts } from "../../domain/application-drafting-v2.ts";
import type { Database } from "../../lib/supabase/database.types.ts";

const EMPTY_DOCUMENT_FACTS: DocumentExactFacts = Object.freeze({
  legalName: null, preferredName: null, familyName: null, email: null, phone: null,
  city: null, region: null, countryCode: null, linkedinUrl: null, websiteUrl: null,
});

const DOCUMENT_FACT_KEYS = new Set([
  "identity.preferred_name",
  "identity.given_name",
  "identity.family_name",
  "identity.legal_name",
  "contact.application_email",
  "contact.phone",
  "contact.linkedin_url",
  "contact.website_url",
  "location.city",
  "location.region",
  "location.country_code",
  "work_authorization.us.authorized",
  "work_authorization.us.sponsorship_required",
  "work_authorization.ca.authorized",
  "work_authorization.ca.sponsorship_required",
]);

export type ApplicationKitExactFacts = Readonly<{
  legalName: string | null;
  contactLines: readonly string[];
  factVersionIds: readonly string[];
  /** Structured values for the v2 document header. */
  document?: DocumentExactFacts;
}>;

export async function loadApplicationKitExactFacts(
  supabase: SupabaseClient<Database>,
  input: Readonly<{
    workspaceId: string;
    candidateId: string;
    applicationId: string;
    inputSnapshotId: string;
  }>,
): Promise<ApplicationKitExactFacts> {
  const { data: refs, error: refError } = await supabase
    .from("application_snapshot_fact_refs")
    .select("fact_version_id")
    .eq("workspace_id", input.workspaceId)
    .eq("candidate_id", input.candidateId)
    .eq("application_id", input.applicationId)
    .eq("input_snapshot_id", input.inputSnapshotId);
  if (refError) throw new Error("APPLICATION_KIT_FACT_REFS_READ_FAILED");
  if (refs.length === 0) {
    return Object.freeze({ legalName: null, contactLines: Object.freeze([]), factVersionIds: Object.freeze([]), document: EMPTY_DOCUMENT_FACTS });
  }

  const versionIds = refs.map((ref) => ref.fact_version_id);
  const { data: versions, error: versionError } = await supabase
    .from("candidate_fact_versions")
    .select("id,fact_id,normalized_text,candidate_disposition,reviewed_at")
    .eq("workspace_id", input.workspaceId)
    .eq("candidate_id", input.candidateId)
    .in("id", versionIds);
  if (versionError) throw new Error("APPLICATION_KIT_FACTS_READ_FAILED");

  const factIds = [...new Set(versions.map((version) => version.fact_id))];
  const { data: facts, error: factError } = await supabase
    .from("candidate_facts")
    .select("id,fact_key,usage_policy,sensitivity")
    .eq("workspace_id", input.workspaceId)
    .eq("candidate_id", input.candidateId)
    .in("id", factIds);
  if (factError) throw new Error("APPLICATION_KIT_FACTS_READ_FAILED");

  const factsById = new Map(facts.map((fact) => [fact.id, fact] as const));
  const values = new Map<string, Readonly<{ value: string; versionId: string }>>();
  for (const version of versions) {
    const fact = factsById.get(version.fact_id);
    if (
      !fact || !DOCUMENT_FACT_KEYS.has(fact.fact_key) ||
      fact.usage_policy !== "EXACT_FIELDS" || fact.sensitivity !== "STANDARD" ||
      version.candidate_disposition !== "APPROVED" || !version.reviewed_at ||
      !version.normalized_text?.trim()
    ) continue;
    values.set(fact.fact_key, Object.freeze({
      value: version.normalized_text.trim(),
      versionId: version.id,
    }));
  }

  const contactLines = [
    [values.get("location.city")?.value, values.get("location.region")?.value, values.get("location.country_code")?.value]
      .filter(Boolean).join(", "),
    values.get("contact.application_email")?.value,
    values.get("contact.phone")?.value,
    values.get("contact.linkedin_url")?.value,
    values.get("contact.website_url")?.value,
  ].filter((value): value is string => Boolean(value));

  const value = (key: string) => values.get(key)?.value ?? null;
  return Object.freeze({
    legalName: value("identity.legal_name"),
    contactLines: Object.freeze(contactLines),
    factVersionIds: Object.freeze([...values.values()].map((entry) => entry.versionId).sort()),
    document: Object.freeze({
      legalName: value("identity.legal_name"),
      preferredName: value("identity.preferred_name"),
      familyName: value("identity.family_name"),
      email: value("contact.application_email"),
      phone: value("contact.phone"),
      city: value("location.city"),
      region: value("location.region"),
      countryCode: value("location.country_code"),
      linkedinUrl: value("contact.linkedin_url"),
      websiteUrl: value("contact.website_url"),
    }),
  });
}
