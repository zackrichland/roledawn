import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StoryBank } from "@/components/profile/StoryBank";
import { displayCareerRange } from "@/domain/career-dates";
import { getOptionalActor } from "@/server/auth/session";
import { getActiveInterview } from "@/server/candidate/interview";
import { getCandidateKnowledge } from "@/server/candidate/knowledge";

export const metadata: Metadata = {
  title: "Stories",
  description: "Specific moments from your work that make applications sound like you.",
};

export default async function StoriesPage() {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/vault/stories");
  const [knowledge, interview] = await Promise.all([getCandidateKnowledge(actor), getActiveInterview().catch(() => null)]);
  const roles = (knowledge.career.profile?.content.positions ?? []).map((position) => ({
    positionKey: position.positionKey,
    title: position.title,
    organization: position.organization,
    dates: displayCareerRange(position.startDate, position.endDate, position.current),
  }));
  return (
    <StoryBank
      interviewActive={interview?.status === "ACTIVE" && interview.turnCount > 1}
      roles={roles}
      stories={knowledge.stories}
      voice={knowledge.voice?.content ?? null}
      voiceAggregateVersion={knowledge.voiceAggregateVersion}
    />
  );
}
