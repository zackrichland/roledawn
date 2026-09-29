import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AnswersForm } from "@/components/profile/AnswersForm";
import { getOptionalActor } from "@/server/auth/session";
import { getCandidateProfile } from "@/server/vault/candidate-profile";

export const metadata: Metadata = {
  title: "Answers",
  description: "The questions every application asks, answered once.",
};

export default async function AnswersPage() {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/vault/answers");
  const profile = await getCandidateProfile(actor);
  return <AnswersForm accountEmail={profile.accountEmail} facts={profile.facts} />;
}
