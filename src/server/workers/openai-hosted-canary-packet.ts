import { createHash } from "node:crypto";

import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import { prepareHostedCanaryPlan, type CanaryPacket, type CanaryPlan } from "./openai-hosted-canary.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Select only employer-useful facts and PDFs from the existing, version-checked
 * execution materializer. No model, parser or historical answer creates facts.
 * Call eraseApplicationFillExecutionPackage after the private plan is sealed.
 */
export function packetFromMaterializedReadback(execution: ApplicationFillExecutionPackage): Readonly<{
  packet: CanaryPacket;
  packetReadbackHash: string;
}> {
  if (execution.schemaRelease !== "application-fill-execution-package/1" ||
      execution.authorityScope !== "FILL_ONLY_NO_SUBMIT" || execution.submitAuthorized !== false) {
    throw new Error("HOSTED_CANARY_READBACK_INVALID");
  }
  const byKey = new Map(execution.facts.map(fact => [fact.factKey, fact.value] as const));
  const value = (key: Parameters<typeof byKey.get>[0]) => byKey.get(key);
  const name = value("identity.legal_name") ?? [value("identity.given_name"), value("identity.family_name")].filter(Boolean).join(" ");
  const email = value("contact.application_email");
  if (!name || !email) throw new Error("HOSTED_CANARY_REQUIRED_FACT_MISSING");
  const location = [value("location.city"), value("location.region"), value("location.country_code")].filter(Boolean).join(", ");
  const facts: CanaryPacket["facts"] = {
    name, email,
    ...(value("contact.phone") ? { phone: value("contact.phone") } : {}),
    ...(location ? { location } : {}),
    ...(value("application.heard_about") ? { heardAbout: value("application.heard_about") } : {}),
    ...(value("education.highest_degree") ? { highestDegree: value("education.highest_degree") } : {}),
    ...(value("work_authorization.us.authorized") ? { usAuthorized: value("work_authorization.us.authorized") } : {}),
    ...(value("work_authorization.us.sponsorship_required") ? { usSponsorshipRequired: value("work_authorization.us.sponsorship_required") } : {}),
  };
  const resume = execution.artifacts.filter(artifact => artifact.variant === "RESUME_PDF");
  const cover = execution.artifacts.filter(artifact => artifact.variant === "COVER_LETTER_PDF");
  if (resume.length !== 1 || cover.length > 1) throw new Error("HOSTED_CANARY_PDF_SET_INVALID");
  const packet: CanaryPacket = {
    facts,
    resumeBase64: Buffer.from(resume[0]!.bytes).toString("base64"),
    ...(cover[0] ? { coverLetterBase64: Buffer.from(cover[0].bytes).toString("base64") } : {}),
  };
  const packetReadbackHash = sha(JSON.stringify({ binding: execution.binding,
    destinationUrl: execution.destinationUrl,
    facts: execution.facts.map(fact => [fact.factKey, fact.factVersionId, fact.valueHash]),
    artifacts: execution.artifacts.map(artifact => [artifact.variant, artifact.artifactVersionId, artifact.sha256, artifact.byteSize]) }));
  return { packet, packetReadbackHash };
}

/** Bind the canary plan to the exact application that produced the approved readback. */
export function prepareHostedCanaryPlanFromReadback(
  execution: ApplicationFillExecutionPackage,
  input: Omit<CanaryPlan, "packetSha256" | "intentSha256" | "createBody" | "taskBody">,
): Readonly<{ plan: CanaryPlan; packetReadbackHash: string }> {
  if (execution.binding.candidateId !== input.candidateId ||
      execution.binding.applicationId !== input.applicationId ||
      execution.destinationUrl !== input.destinationUrl) {
    throw new Error("HOSTED_CANARY_READBACK_BINDING_MISMATCH");
  }
  const { packet, packetReadbackHash } = packetFromMaterializedReadback(execution);
  return { plan: prepareHostedCanaryPlan({ ...input, packet }), packetReadbackHash };
}
