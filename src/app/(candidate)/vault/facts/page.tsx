import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { reviewCandidateEvidenceAction } from "@/app/vault/evidence-actions";
import { VerifiedFacts } from "@/components/vault/VerifiedFacts";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import { getCandidateEvidenceWorkspace } from "@/server/vault/candidate-evidence";

export const metadata: Metadata = {
  title: "Résumé evidence",
  description: "Candidate-reviewed résumé evidence with immutable source provenance.",
};

export default async function VerifiedFactsPage() {
  if (!readSupabasePublicConfig()) return null;
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/vault/facts");
  const evidence = await getCandidateEvidenceWorkspace(actor);
  return <VerifiedFacts action={reviewCandidateEvidenceAction} evidence={evidence} />;
}
